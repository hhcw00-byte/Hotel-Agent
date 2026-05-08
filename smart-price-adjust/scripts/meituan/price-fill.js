"use strict";

const { SELECTORS } = require("./selectors");
const {
  baseName,
  compactText,
  normalizeName,
  scoreMatch,
  throwMeituanError
} = require("./mapper");

async function fillPrices(page, roomList) {
  const rooms = Array.isArray(roomList) ? roomList : [];
  const results = [];

  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index] || {};
    assertTargetPage(page, "before_price_fill");
    const filled = await fillRoomPriceWithRetry(page, room);
    results.push({
      roomIndex: index,
      roomName: String(room.roomName || "").trim(),
      price: String(room.price),
      inputPrice: String(room.price),
      matchedPlatformRoomName: filled.matchedRowText,
      matchStrategy: filled.matchStrategy,
      ok: true,
      success: true,
      failureCode: null,
      message: "price_filled_waiting_submit",
      priceFilled: true,
      priceEchoMatched: true,
      submitClicked: false
    });
  }

  await triggerPageChange(page);
  return results;
}

async function fillRoomPriceWithRetry(page, room) {
  const roomName = String(room && room.roomName || "").trim();
  const targetPrice = normalizePrice(room && room.price);
  let last = {
    roomName,
    targetPrice,
    lastReadValue: "",
    inputSelector: SELECTORS.priceRowInput,
    matchedRowText: "",
    retryCount: 0
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertTargetPage(page, "during_price_fill");
    const target = await findPriceInputTarget(page, roomName);
    if (!target) {
      throwMeituanError("PRICE_INPUT_NOT_FOUND", "fill_price", `Meituan price input not found: ${roomName}`, {
        ...last,
        retryCount: attempt
      });
    }

    const input = target.row.locator(SELECTORS.priceRowInput).first();
    if (!(await isUsableInput(input))) {
      throwMeituanError("PRICE_INPUT_NOT_FOUND", "fill_price", `Meituan price input not found: ${roomName}`, {
        ...last,
        inputSelector: SELECTORS.priceRowInput,
        matchedRowText: target.rowText,
        retryCount: attempt
      });
    }

    const method = attempt === 0 ? "set_value" : "keyboard_type";
    await fillPriceInput(page, input, targetPrice, method);
    const echo = await waitPriceEcho(page, input, targetPrice, 5000);
    last = {
      roomName,
      targetPrice,
      lastReadValue: echo.value,
      inputSelector: SELECTORS.priceRowInput,
      matchedRowText: target.rowText,
      retryCount: attempt
    };
    if (echo.matched) {
      return {
        matchedRowText: target.rowText,
        matchStrategy: target.matchStrategy
      };
    }
    await page.waitForTimeout(250).catch(() => {});
  }

  throwMeituanError("PRICE_ECHO_MISMATCH", "verify_price_echo", `Meituan price echo mismatch: ${roomName}`, last);
}

async function findPriceInputTarget(page, roomName) {
  await page.waitForSelector(SELECTORS.priceTable, { timeout: 5000 }).catch(() => {});
  const rows = page.locator(SELECTORS.priceRow);
  const count = Math.min(await rows.count().catch(() => 0), 200);
  const target = normalizeName(roomName);
  const targetBase = baseName(roomName);
  const matches = [];

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const input = row.locator(SELECTORS.priceRowInput).first();
    if (!(await isUsableInput(input))) continue;

    const rowText = await readRowText(row);
    const normalized = normalizeName(rowText);
    const base = baseName(rowText);
    const score = scoreMatch({ normalized, base }, { target, targetBase });
    if (score <= 0) continue;
    matches.push({
      row,
      rowText,
      score,
      matchStrategy: score >= 400
        ? "exact"
        : score >= 300
          ? "base_exact"
          : score >= 200
            ? "contains"
            : "base_contains"
    });
  }

  matches.sort((left, right) => right.score - left.score);
  return matches[0] || null;
}

async function fillPriceInput(page, input, value, method) {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ force: true }).catch(() => {});
  await input.focus().catch(() => {});
  await input.press("Control+A").catch(() => {});
  await input.press("Backspace").catch(() => {});
  await page.waitForTimeout(100).catch(() => {});

  if (method === "set_value") {
    await setInputValue(input, value);
  } else {
    await input.type(value, { delay: 80 }).catch(async () => {
      await page.keyboard.type(value, { delay: 80 });
    });
  }

  await input.evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof node.blur === "function") node.blur();
  }).catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
}

async function setInputValue(input, value) {
  await input.evaluate((node, nextValue) => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (descriptor && typeof descriptor.set === "function") descriptor.set.call(node, nextValue);
    else node.value = nextValue;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof node.blur === "function") node.blur();
  }, String(value));
}

async function waitPriceEcho(page, input, expected, timeoutMs) {
  const started = Date.now();
  let value = "";
  while (Date.now() - started < timeoutMs) {
    value = await input.inputValue().catch(() => "");
    if (pricesEqual(value, expected)) return { matched: true, value };
    await page.waitForTimeout(250).catch(() => {});
  }
  return { matched: false, value };
}

async function triggerPageChange(page) {
  await page.keyboard.press("Tab").catch(() => {});
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
  }).catch(() => {});
  await page.waitForTimeout(250).catch(() => {});
}

async function isUsableInput(input) {
  if (!(await input.count().catch(() => 0))) return false;
  if (!(await input.isVisible().catch(() => false))) return false;
  if (!(await input.isEnabled().catch(() => false))) return false;
  return input.evaluate((node) => !node.readOnly && !node.disabled).catch(() => false);
}

async function readRowText(row) {
  const nameText = await row.locator(SELECTORS.priceRowName).first().innerText().catch(() => "");
  return compactText(nameText || await row.innerText().catch(() => ""));
}

function pricesEqual(actualValue, expectedValue) {
  const actual = normalizePrice(actualValue);
  const expected = normalizePrice(expectedValue);
  return Boolean(actual && expected && Number(actual) === Number(expected));
}

function normalizePrice(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  const numeric = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return text;
  return String(numeric);
}

function assertTargetPage(page, stage) {
  const url = String(page && typeof page.url === "function" ? page.url() : "");
  if (!url.toLowerCase().includes("/ebooking/merchant/product/batch-price")) {
    throwMeituanError("TARGET_PAGE_LEFT", "page_guard", `Meituan target page left during price fill: ${url}`, {
      stage,
      url
    });
  }
}

module.exports = {
  fillPrices
};
