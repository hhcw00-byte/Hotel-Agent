"use strict";

const { selectors } = require("./selectors");
const {
  buildBookingRoomSuccess,
  isVisible,
  safeText,
  compactText,
  priceMatches,
  throwBookingError
} = require("./mapper");

async function fillPrice(page, panel, room) {
  const pricesExpanded = await openPriceSection(panel);
  await selectRatePlan(page, panel, room.roomName);
  const target = await resolvePriceInput(panel, room.roomName);
  if (!target) {
    throwBookingError("PRICE_INPUT_NOT_FOUND", "fill_price", `Booking price input not found: ${room.roomName}`, await priceDiagnostics(panel, room, { pricesExpanded }));
  }

  const price = String(room.price || "").trim();
  let lastValue = "";
  let inputMethodUsed = "";
  let inputId = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const input = await resolvePriceInput(panel, room.roomName);
    if (!input) break;
    inputId = await input.getAttribute("id").catch(() => "");
    inputMethodUsed = attempt === 0 ? "keyboard_primary" : (attempt === 1 ? "set_value_events" : "keyboard_retry");
    if (attempt === 1) await setInputValue(input, price);
    else await typeInputValue(input, price, { forceDirty: attempt === 0 });
    lastValue = await waitForPriceEcho(input, price);
    if (priceMatches(lastValue, price)) {
      return [buildBookingRoomSuccess(room, {
        matchedRatePlan: room.roomName,
        inputId
      })];
    }
  }

  throwBookingError("PRICE_ECHO_MISMATCH", "verify_price_echo", `Booking price echo mismatch: ${room.roomName}`, {
    roomName: String(room.roomName || ""),
    targetPrice: price,
    lastReadValue: lastValue,
    inputId,
    priceSelectValue: await readPriceSelectValue(panel),
    pricesExpanded,
    retryCount: 2,
    inputMethodUsed,
    ...(await priceDiagnostics(panel, room, { pricesExpanded, inputId, lastReadValue: lastValue, retryCount: 2 }))
  });
}

async function openPriceSection(panel) {
  const section = await resolvePricesAccordion(panel);
  if (!section) return await waitForPricesArea(panel, 1000);
  const expanded = await section.getAttribute("aria-expanded").catch(() => "");
  if (expanded === "false" || !await pricesAreaReady(panel)) {
    await clickPricesAccordion(section);
    await panel.page().waitForTimeout(250);
  }
  return await waitForPricesArea(panel, 5000);
}

async function resolvePricesAccordion(panel) {
  for (const selector of selectors.priceSection) {
    const locator = panel.locator(selector).first();
    if (await isVisible(locator)) return locator;
  }
  return null;
}

async function clickPricesAccordion(section) {
  await section.scrollIntoViewIfNeeded().catch(() => {});
  await section.click({ timeout: 2000 }).catch(async () => {
    await section.evaluate((node) => {
      if (node && typeof node.click === "function") node.click();
    }).catch(() => {});
  });
}

async function selectRatePlan(page, panel, roomName) {
  const select = await firstVisible(panel, selectors.ratePlanControl);
  if (!select) {
    if (await panel.locator(`text=${roomName}`).first().isVisible({ timeout: 1000 }).catch(() => false)) return;
    throwBookingError("PRICE_INPUT_NOT_FOUND", "fill_price", `Booking rate plan not found: ${roomName}`, await priceDiagnostics(panel, { roomName }));
  }

  const tagName = await select.evaluate((node) => String(node.tagName || "").toLowerCase()).catch(() => "");
  if (tagName === "select") {
    const optionValue = await findNativeOptionValue(select, roomName);
    if (!optionValue) {
      throwBookingError("PRICE_INPUT_NOT_FOUND", "fill_price", `Booking rate plan option not found: ${roomName}`, await priceDiagnostics(panel, { roomName }));
    }
    await select.selectOption(optionValue);
    await panel.page().waitForTimeout(250);
    return;
  }

  await select.click({ timeout: 3000 });
  const option = page.locator(`[role="option"]:has-text("${escapeText(roomName)}"), li:has-text("${escapeText(roomName)}"), button:has-text("${escapeText(roomName)}")`).first();
  if (!await isVisible(option)) {
    throwBookingError("PRICE_INPUT_NOT_FOUND", "fill_price", `Booking rate plan option not found: ${roomName}`, await priceDiagnostics(panel, { roomName }));
  }
  await option.click({ timeout: 3000 });
  await panel.page().waitForTimeout(250);
}

async function resolvePriceInput(panel, roomName) {
  const direct = await firstVisible(panel, selectors.priceInput);
  if (direct) return direct;

  const text = compactText(roomName);
  const rows = panel.locator("div, section, li, tr").filter({ hasText: roomName });
  const count = await rows.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 20); index += 1) {
    const row = rows.nth(index);
    if (!await isVisible(row)) continue;
    const rowText = compactText(await safeText(row));
    if (!rowText.includes(text)) continue;
    const input = await firstVisible(row, selectors.priceInput);
    if (input) return input;
  }
  return null;
}

async function setInputValue(input, price) {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ timeout: 3000 }).catch(() => {});
  await input.focus({ timeout: 3000 }).catch(() => {});
  await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
  await input.press("Backspace").catch(() => {});
  await input.evaluate((node, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (setter && setter.set) setter.set.call(node, String(value));
    else node.value = String(value);
    const inputEvent = typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) })
      : new Event("input", { bubbles: true });
    node.dispatchEvent(inputEvent);
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }, price);
  await input.page().waitForTimeout(250);
  await input.blur().catch(() => {});
  await input.press("Enter").catch(() => {});
}

async function typeInputValue(input, price, options = {}) {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ timeout: 3000 }).catch(() => {});
  await input.focus({ timeout: 3000 }).catch(() => {});
  const before = await input.inputValue().catch(() => "");
  if (options.forceDirty && priceMatches(before, price)) {
    await typeRawValue(input, temporaryPrice(price));
    await input.page().waitForTimeout(150);
  }
  await typeRawValue(input, price);
}

async function typeRawValue(input, price) {
  await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
  await input.press("Backspace").catch(() => {});
  await input.type(price, { delay: 80 });
  await input.press("Enter").catch(() => {});
  await input.evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }).catch(() => {});
  await input.blur().catch(() => {});
  await input.page().waitForTimeout(250);
}

function temporaryPrice(price) {
  const number = Number(String(price || "").replace(/,/g, ""));
  if (!Number.isFinite(number) || number <= 1) return "1";
  return String(Math.max(1, Math.floor(number) - 1));
}

async function waitForPriceEcho(input, price) {
  let lastValue = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    lastValue = await input.inputValue().catch(async () => safeText(input));
    if (priceMatches(lastValue, price)) return lastValue;
    await input.page().waitForTimeout(250);
  }
  return lastValue;
}

async function waitForPricesArea(panel, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pricesAreaReady(panel)) return true;
    await panel.page().waitForTimeout(250);
  }
  return await pricesAreaReady(panel);
}

async function pricesAreaReady(panel) {
  return Boolean(
    await isVisible(panel.locator("select#price-select-0").first())
    || await isVisible(panel.locator("input#price-input-0").first())
    || await isVisible(panel.locator("input[aria-label=\"Enter price amount\"]").first())
    || await isVisible(panel.locator("input[aria-label=\"\u8f93\u5165\u4ef7\u683c\u91d1\u989d\"]").first())
  );
}

async function findNativeOptionValue(select, roomName) {
  const target = compactText(roomName);
  const options = await select.evaluate((node) => Array.from(node.options || []).map((option) => ({
    value: String(option.value || ""),
    text: String(option.textContent || "")
  }))).catch(() => []);
  const exact = options.find((option) => compactText(option.text) === target);
  const contained = options.find((option) => compactText(option.text).includes(target) || target.includes(compactText(option.text)));
  const selected = exact || contained;
  return selected ? selected.value : "";
}

async function firstVisible(scope, selectorList) {
  for (const selector of selectorList) {
    const locator = scope.locator(selector).first();
    if (await isVisible(locator)) return locator;
  }
  return null;
}

async function readPriceSelectValue(panel) {
  return panel.locator("select#price-select-0").first().inputValue().catch(() => "");
}

async function priceDiagnostics(panel, room, extra = {}) {
  const inputs = await panel.locator("input").evaluateAll((nodes) => nodes.slice(0, 20).map((node) => ({
    id: node.getAttribute("id") || "",
    name: node.getAttribute("name") || "",
    placeholder: node.getAttribute("placeholder") || "",
    ariaLabel: node.getAttribute("aria-label") || "",
    value: node.value || ""
  }))).catch(() => []);
  return {
    roomName: String(room && room.roomName || ""),
    targetPrice: String(room && room.price || ""),
    dateFromValue: await readInputBySelector(panel, "#date-from, [data-test-id=\"date-from\"]"),
    dateUntilValue: await readInputBySelector(panel, "#date-until, [data-test-id=\"date-until\"]"),
    pricesAccordionFound: Boolean(await resolvePricesAccordion(panel)),
    priceSelectVisible: await isVisible(panel.locator("select#price-select-0").first()),
    priceInputVisible: await isVisible(panel.locator("input#price-input-0").first()),
    visibleButtons: await collectVisibleButtons(panel),
    visibleAccordionTexts: await collectVisibleAccordionTexts(panel),
    lastReadValue: extra.lastReadValue || "",
    inputId: extra.inputId || "",
    priceSelectValue: await readPriceSelectValue(panel),
    pricesExpanded: Boolean(extra.pricesExpanded || await pricesAreaReady(panel)),
    retryCount: Number(extra.retryCount || 0),
    visibleInputs: inputs
  };
}

async function readInputBySelector(panel, selector) {
  return panel.locator(selector).first().inputValue().catch(() => "");
}

async function collectVisibleButtons(panel) {
  return panel.locator("button, [role=\"button\"]").evaluateAll((nodes) => nodes
    .filter((node) => !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length))
    .map((node) => String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30)).catch(() => []);
}

async function collectVisibleAccordionTexts(panel) {
  return panel.locator("button[data-test-id=\"accordion\"], [aria-expanded]").evaluateAll((nodes) => nodes
    .filter((node) => !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length))
    .map((node) => String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20)).catch(() => []);
}

function escapeText(value) {
  return String(value || "").replace(/(["\\])/g, "\\$1");
}

module.exports = {
  fillPrice
};
