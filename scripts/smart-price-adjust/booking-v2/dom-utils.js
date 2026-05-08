"use strict";

const { SELECTORS, SUCCESS_PHRASES } = require("./selectors");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePrice(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

async function isVisible(locator, timeoutMs = 500) {
  return locator.isVisible({ timeout: timeoutMs }).catch(() => false);
}

async function findFirstVisible(root, selectors, timeoutMs = 1000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const selector of list) {
    const locator = root.locator(selector).first();
    if (await locator.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function setInputValue(input, value, options = {}) {
  const text = String(value === undefined || value === null ? "" : value);
  await input.waitFor({ state: "visible", timeout: options.timeoutMs || 5000 });
  await input.evaluate((node, nextValue) => {
    node.focus();
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(node, nextValue);
    else node.value = nextValue;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
  if (options.blur) {
    await input.evaluate((node) => node.blur()).catch(() => {});
  }
}

async function readInputValue(input) {
  return input.evaluate((node) => String(node.value || "")).catch(() => "");
}

async function getPanelFromInput(page, input) {
  const panel = input.locator([
    "xpath=ancestor::*[",
    "@role='dialog' or @aria-modal='true' or self::aside",
    " or contains(translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'modal')",
    " or contains(translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'drawer')",
    " or contains(translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'panel')",
    "][1]"
  ].join(""));
  if (await panel.count().catch(() => 0)) return panel.first();
  return page.locator("body");
}

async function openPriceSection(panel, timeoutMs) {
  const priceInput = panel.locator(SELECTORS.priceInput).first();
  if (await isVisible(priceInput, 500)) return priceInput;

  const accordions = panel.locator(SELECTORS.accordion);
  const count = await accordions.count().catch(() => 0);
  if (!count) {
    const error = new Error("Booking V2 price accordion was not found in the current Bulk edit panel.");
    error.code = "PRICE_SECTION_NOT_FOUND";
    error.stage = "PRICE_SECTION_NOT_FOUND";
    throw error;
  }

  for (let index = 0; index < count; index += 1) {
    const accordion = accordions.nth(index);
    if (!await isVisible(accordion, 300)) continue;
    await accordion.click({ timeout: Math.min(timeoutMs || 5000, 5000) }).catch(() => {});
    if (await priceInput.isVisible({ timeout: 1000 }).catch(() => false)) return priceInput;
  }

  const error = new Error("Booking V2 price input #price-input-0 was not found after opening accordions.");
  error.code = "PRICE_INPUT_NOT_FOUND";
  error.stage = "PRICE_INPUT_NOT_FOUND";
  throw error;
}

async function getPriceFormSubmitButton(panel) {
  const priceInput = panel.locator(SELECTORS.priceInput).first();
  const form = priceInput.locator("xpath=ancestor::form[1]");
  if (!await form.count().catch(() => 0)) return null;
  return form.first().locator(SELECTORS.submitButton).first();
}

async function clickEnabledPriceSubmit(panel, timeoutMs) {
  const priceInput = panel.locator(SELECTORS.priceInput).first();
  const form = priceInput.locator("xpath=ancestor::form[1]");
  const submit = form.first().locator(SELECTORS.enabledSubmitButton).first();
  await submit.click({ timeout: Math.min(timeoutMs || 5000, 5000) });
}

async function waitForSuccessStatus(page, timeoutMs) {
  const deadline = Date.now() + Math.max(1000, timeoutMs || 12000);
  while (Date.now() < deadline) {
    const texts = await page.locator(SELECTORS.status).evaluateAll((nodes) => {
      return nodes.map((node) => String(node.textContent || ""));
    }).catch(() => []);
    const hit = texts.map(normalizeText).find(matchesSuccessText);
    if (hit) return { text: hit };
    await page.waitForTimeout(300).catch(() => {});
  }
  const error = new Error("Booking V2 save success status was not detected.");
  error.code = "SAVE_SUCCESS_NOT_DETECTED";
  error.stage = "SAVE_SUCCESS_NOT_DETECTED";
  throw error;
}

function matchesSuccessText(text) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  return SUCCESS_PHRASES.some((phrase) => {
    const expected = String(phrase || "");
    return expected === expected.toLowerCase()
      ? lower.includes(expected)
      : normalized.includes(expected);
  });
}

async function closePanel(page, panel) {
  for (const selector of SELECTORS.closeButton) {
    const button = panel.locator(selector).first();
    if (await isVisible(button, 300)) {
      await button.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300).catch(() => {});
      return;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300).catch(() => {});
}

module.exports = {
  normalizeText,
  normalizePrice,
  isVisible,
  findFirstVisible,
  setInputValue,
  readInputValue,
  getPanelFromInput,
  openPriceSection,
  getPriceFormSubmitButton,
  clickEnabledPriceSubmit,
  waitForSuccessStatus,
  closePanel
};
