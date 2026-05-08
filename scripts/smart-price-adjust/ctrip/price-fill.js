"use strict";

const { SELECTORS } = require("./selectors");
const { throwCtripError, normalizeText, compactText, normalizePrice } = require("./mapper");

async function fillPrices(page, rooms, selectedRooms = []) {
  const results = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const selected = selectedRooms[index] || {};
    const filled = await fillRoomPriceWithRetry(page, room);

    results.push({
      roomIndex: index,
      roomName: room.roomName,
      price: String(room.price),
      inputPrice: String(room.price),
      matchedPlatformRoomName: filled.titleText || selected.matchedPlatformRoomName || room.roomName,
      matchStrategy: filled.strategy,
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
  const expected = normalizePrice(room.price);
  let last = { value: "", inputId: "", titleText: "", retryCount: 0, inputMethodUsed: "" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inputMethodUsed = attempt === 0 ? "set_value" : "keyboard_type";
    const match = await findPriceRow(page, room.roomName);
    if (!match) {
      throwCtripError(
        "PRICE_INPUT_NOT_FOUND",
        "fill_price",
        `Ctrip price row not found: ${room.roomName}`,
        { roomName: room.roomName, targetPrice: String(room.price), allVisibleProductTitles: await collectProductTitles(page), retryCount: attempt, inputMethodUsed }
      );
    }

    const input = match.row.locator(SELECTORS.priceInput).first();
    if (!(await input.count()) || !(await input.isVisible().catch(() => false))) {
      throwCtripError(
        "PRICE_INPUT_NOT_FOUND",
        "fill_price",
        `Ctrip price input not found: ${room.roomName}`,
        { roomName: room.roomName, targetPrice: String(room.price), matchedProductTitle: match.titleText, allVisibleProductTitles: await collectProductTitles(page), retryCount: attempt, inputMethodUsed }
      );
    }

    await fillPriceInput(page, input, room.price, inputMethodUsed);
    const echo = await waitPriceEcho(page, input, expected, 5000);
    last = {
      value: echo.value,
      inputId: await input.getAttribute("id").catch(() => ""),
      titleText: match.titleText,
      strategy: match.strategy,
      retryCount: attempt,
      inputMethodUsed
    };
    if (echo.matched) return { titleText: match.titleText, strategy: match.strategy };
    await page.waitForTimeout(300);
  }

  throwCtripError(
    "PRICE_ECHO_NOT_MATCHED",
    "verify_price_echo",
    `Ctrip price echo mismatch: ${room.roomName}`,
    {
      roomName: room.roomName,
      targetPrice: String(room.price),
      lastReadValue: last.value,
      inputId: last.inputId,
      matchedProductTitle: last.titleText,
      retryCount: last.retryCount,
      inputMethodUsed: last.inputMethodUsed,
      allVisibleProductTitles: await collectProductTitles(page)
    }
  );
}

async function fillPriceInput(page, input, price, method) {
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ force: true }).catch(() => {});
  await input.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(120);
  if (method === "set_value") {
    await setInputValue(input, String(price).trim());
  } else {
    await input.type(String(price).trim(), { delay: 80 });
  }
  await input.evaluate((el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof el.blur === "function") el.blur();
  });
  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(250);
}

async function setInputValue(input, value) {
  await input.evaluate((el, nextValue) => {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") descriptor.set.call(el, nextValue);
    else el.value = nextValue;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function waitPriceEcho(page, input, expected, timeoutMs) {
  const started = Date.now();
  let value = "";
  while (Date.now() - started < timeoutMs) {
    value = await input.inputValue().catch(() => "");
    if (pricesEqual(value, expected)) return { matched: true, value };
    await page.waitForTimeout(250);
  }
  return { matched: false, value };
}

function pricesEqual(actualValue, expectedNormalized) {
  const actual = normalizePrice(actualValue);
  const expected = normalizePrice(expectedNormalized);
  return actual && expected && Number(actual) === Number(expected);
}

async function triggerPageChange(page) {
  await page.keyboard.press("Tab").catch(() => {});
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
  }).catch(() => {});
  await page.waitForTimeout(300);
}

async function findPriceRow(page, roomName) {
  const titles = page.locator(SELECTORS.priceRowTitle);
  const target = compactText(roomName);
  const count = Math.min(await titles.count(), 200);
  const matches = [];

  for (let index = 0; index < count; index += 1) {
    const title = titles.nth(index);
    if (!(await title.isVisible().catch(() => false))) continue;
    const titleText = normalizeText(await title.innerText().catch(() => ""));
    const row = await findTitlePriceRow(title);
    if (!row) continue;

    const full = compactText(titleText);
    const base = compactText(toBaseProductName(titleText));
    let strategy = "";
    if (full === target) strategy = "exact_title";
    else if (full.includes(target)) strategy = "title_contains_room";
    else if (base === target || base.includes(target)) strategy = "base_name_match";
    if (!strategy) continue;

    matches.push({ row, titleText, strategy, score: scoreProductTitle(titleText, strategy) });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches[0] || null;
}

async function findTitlePriceRow(title) {
  const row = title.locator("xpath=ancestor::*[.//input[starts-with(@id,'data_') and contains(@id,'_priceChangeData_price')]][1]").first();
  if (!(await row.count())) return null;
  const input = row.locator(SELECTORS.priceInput).first();
  if (!(await input.count()) || !(await input.isVisible().catch(() => false)) || !(await input.isEnabled().catch(() => false))) return null;
  return row;
}

async function collectProductTitles(page) {
  const titles = page.locator(SELECTORS.priceRowTitle);
  const count = Math.min(await titles.count(), 200);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const title = titles.nth(index);
    if (!(await title.isVisible().catch(() => false))) continue;
    const text = normalizeText(await title.innerText().catch(() => ""));
    if (text) out.push(text);
  }
  return out;
}

function scoreProductTitle(titleText, strategy) {
  let score = strategy === "exact_title" ? 300 : strategy === "title_contains_room" ? 200 : 100;
  const text = normalizeText(titleText);
  if (!text.includes("\u9884\u552e")) score += 30;
  if (text.includes("<\u65e0\u65e9>")) score += 20;
  return score;
}

function toBaseProductName(text) {
  return normalizeText(text)
    .replace(/<[^>]*>/g, "")
    .replace(/\uFF08[^\uFF09]*\uFF09/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
}

module.exports = {
  fillPrices
};
