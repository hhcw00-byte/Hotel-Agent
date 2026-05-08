"use strict";

const {
  SELECTORS,
  SUBMIT_CONFIRM_TEXTS,
  SUBMIT_SUCCESS_TEXTS
} = require("./selectors");
const { compactText } = require("./mapper");

function watchBusinessSubmitResponse(page) {
  const state = {
    businessResponseMatched: false
  };

  const handler = async (response) => {
    const classified = await classifySubmitResponse(response);
    if (!classified.observed) return;
    state.businessResponseMatched = Boolean(classified.responseSuccess);
  };

  page.on("response", handler);
  return {
    state,
    reset: () => {
      state.businessResponseMatched = false;
    },
    stop: () => page.off("response", handler)
  };
}

async function waitSubmitSuccess(page, watcher, timeoutMs = 10000) {
  const started = Date.now();
  await waitSubmitSettled(page, 1500);

  while (Date.now() - started < timeoutMs) {
    const snapshot = await readSubmitFeedbackSnapshot(page, started, watcher && watcher.state);
    if (snapshot.success) return snapshot;
    await page.waitForTimeout(300).catch(() => {});
  }

  await waitSubmitSettled(page, 1500);
  return readSubmitFeedbackSnapshot(page, started, watcher && watcher.state);
}

async function clickSubmitConfirmButton(page, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
  const started = Date.now();

  do {
    const buttons = page.locator(SELECTORS.submitConfirmButton);
    const total = Math.min(await buttons.count().catch(() => 0), 12);
    for (let index = 0; index < total; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      const modalText = await readClosestModalText(button);
      if (!isSubmitConfirmText(modalText)) continue;
      if (!(await button.isEnabled().catch(() => false))) continue;
      await button.click({ force: true }).catch(() => {});
      return { clicked: true, modalText };
    }
    if (timeoutMs <= 0) break;
    await page.waitForTimeout(150).catch(() => {});
  } while (Date.now() - started < timeoutMs);

  return { clicked: false, modalText: "" };
}

async function waitSubmitConfirmDialog(page, timeoutMs = 2500) {
  const started = Date.now();
  let modalText = "";
  do {
    const texts = await collectVisibleTexts(page, SELECTORS.submitConfirmDialog, 8);
    modalText = texts.find(isSubmitConfirmText) || "";
    if (modalText) {
      return { detected: true, modalText };
    }
    if (timeoutMs <= 0) break;
    await page.waitForTimeout(150).catch(() => {});
  } while (Date.now() - started < timeoutMs);
  return { detected: false, modalText: "" };
}

async function waitPageReadyAfterSubmit(page, timeoutMs = 1500) {
  const started = Date.now();
  let reason = "";
  while (Date.now() - started < timeoutMs) {
    const ready = await isPageReady(page);
    if (ready) return { ready: true, reason: "" };
    reason = await explainPageReady(page);
    await page.waitForTimeout(250).catch(() => {});
  }
  return {
    ready: false,
    reason: reason || "page_not_ready_after_submit"
  };
}

async function readSubmitFeedbackSnapshot(page, started, businessState = {}) {
  const visibleToastTexts = await collectVisibleTexts(page, SELECTORS.toastFeedback, 8);
  const visibleModalTexts = await collectVisibleTexts(page, SELECTORS.visibleModal, 8);
  const allText = [...visibleToastTexts, ...visibleModalTexts].join(" | ");
  const uiSuccess = isSuccessText(allText);
  const confirmDialogDetected = visibleModalTexts.some(isSubmitConfirmText);
  const businessResponseMatched = Boolean(businessState && businessState.businessResponseMatched);

  return {
    success: !confirmDialogDetected && (uiSuccess || businessResponseMatched),
    source: confirmDialogDetected ? "confirm_dialog" : businessResponseMatched ? "business_response" : uiSuccess ? "ui_feedback" : "none",
    hasDialog: visibleModalTexts.some(isSuccessText),
    text: compactText(allText).slice(0, 500),
    observedMs: Date.now() - started,
    diagnostics: {
      visibleToastTexts,
      visibleModalTexts,
      submitButtonText: await readSubmitButtonText(page),
      submitFeedbackWaitMs: Date.now() - started,
      businessResponseMatched,
      confirmDialogDetected,
      pageRecoveryWarning: false
    }
  };
}

async function classifySubmitResponse(response) {
  const url = String(response && response.url ? response.url() : "");
  if (!url.includes("/product/price/updatePriceV2")) {
    return { observed: false, url, status: 0, responseCode: "", responseSuccess: false };
  }

  const status = Number(response.status ? response.status() : 0);
  const text = await response.text().catch(() => "");
  const parsed = tryParseJson(text);
  const responseCode = parsed && parsed.code !== undefined ? String(parsed.code) : "";
  const responseSuccess = Boolean(
    status >= 200
    && status < 300
    && (
      (parsed && (parsed.success === true || String(parsed.code) === "10000"))
      || text.includes("\"success\":true")
      || text.includes("\"code\":10000")
    )
  );
  return { observed: true, url, status, responseCode, responseSuccess };
}

async function collectVisibleTexts(page, selector, limit) {
  const loc = page.locator(selector);
  const count = Math.min(await loc.count().catch(() => 0), limit);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const item = loc.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = compactText(await item.innerText().catch(() => ""));
    if (text) out.push(text);
  }
  return out;
}

async function waitSubmitSettled(page, timeoutMs) {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const loading = page.locator(SELECTORS.loading).first();
    if (!(await loading.isVisible().catch(() => false))) return;
    await page.waitForTimeout(200).catch(() => {});
  }
}

async function readClosestModalText(button) {
  return button.evaluate((node) => {
    const modal = node && node.closest(".mtd-confirm, .mtd-modal, .mtd-modal-body");
    return String((modal || node).textContent || "").replace(/\s+/g, " ").trim();
  }).catch(() => "");
}

async function readSubmitButtonText(page) {
  const buttons = page.locator(SELECTORS.submitButton);
  const count = Math.min(await buttons.count().catch(() => 0), 30);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const text = compactText(await button.innerText().catch(() => ""));
    if (text) return text;
  }
  return "";
}

async function isPageReady(page) {
  const targetUrl = String(page && typeof page.url === "function" ? page.url() : "");
  const loadingVisible = await page.locator(SELECTORS.loading).first().isVisible().catch(() => false);
  const priceTableVisible = await page.locator(SELECTORS.priceTable).first().isVisible().catch(() => false);
  const submitButtonVisible = await page.locator(SELECTORS.submitButton).first().isVisible().catch(() => false);
  return targetUrl.toLowerCase().includes("/ebooking/merchant/product/batch-price")
    && !loadingVisible
    && priceTableVisible
    && submitButtonVisible;
}

async function explainPageReady(page) {
  const targetUrl = String(page && typeof page.url === "function" ? page.url() : "");
  const missing = [];
  if (!targetUrl.toLowerCase().includes("/ebooking/merchant/product/batch-price")) missing.push("target_page_left");
  if (await page.locator(SELECTORS.loading).first().isVisible().catch(() => false)) missing.push("loading_visible");
  if (!(await page.locator(SELECTORS.priceTable).first().isVisible().catch(() => false))) missing.push("price_table_not_ready");
  if (!(await page.locator(SELECTORS.submitButton).first().isVisible().catch(() => false))) missing.push("submit_button_not_ready");
  return missing.length ? missing.join(",") : "page_not_ready_after_submit";
}

function isSuccessText(text) {
  const value = compactText(text);
  return !isSubmitConfirmText(value) && SUBMIT_SUCCESS_TEXTS.some((keyword) => value.includes(keyword));
}

function isSubmitConfirmText(text) {
  const value = compactText(text);
  return SUBMIT_CONFIRM_TEXTS.some((keyword) => value.includes(keyword));
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

module.exports = {
  watchBusinessSubmitResponse,
  waitSubmitSuccess,
  waitSubmitConfirmDialog,
  clickSubmitConfirmButton,
  waitPageReadyAfterSubmit,
  classifySubmitResponse,
  collectVisibleTexts,
  readSubmitButtonText
};
