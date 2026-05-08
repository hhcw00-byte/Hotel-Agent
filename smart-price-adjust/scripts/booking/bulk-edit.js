"use strict";

const { selectors } = require("./selectors");
const { isVisible, safeText, throwBookingError } = require("./mapper");

async function openBulkEdit(page, timeoutMs = 30000) {
  const reusablePanel = await detectReusableBulkEditPanel(page);
  if (reusablePanel) return reusablePanel;
  if (await isBulkEditAreaReady(page)) return page.locator("body").first();

  const button = await waitForFirstVisible(page, selectors.bulkEditButton, Math.min(timeoutMs, 10000));
  if (!button) {
    throwBookingError(
      "BULK_EDIT_NOT_FOUND",
      "open_bulk_edit",
      "Booking Bulk edit button was not found.",
      await collectBulkEditDiagnostics(page, false)
    );
  }

  await clickLocator(button);
  const panel = await waitForBulkEditPanel(page, Math.min(timeoutMs, 5000));
  if (!panel) {
    throwBookingError(
      "BULK_EDIT_NOT_FOUND",
      "open_bulk_edit",
      "Booking Bulk edit panel did not open.",
      await collectBulkEditDiagnostics(page, true)
    );
  }
  return panel;
}

async function waitForBulkEditPanel(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isBulkEditAreaReady(page)) return page.locator("body").first();

    for (const selector of selectors.bulkEditPanel) {
      const candidates = page.locator(selector);
      const count = await candidates.count().catch(() => 0);
      for (let index = 0; index < Math.min(count, 8); index += 1) {
        const candidate = candidates.nth(index);
        if (!await isVisible(candidate)) continue;
        const text = await safeText(candidate);
        if (/Bulk edit|Save changes|Prices?|批量编辑|保存修改|价格/i.test(text)) return candidate;
      }
    }
    await page.waitForTimeout(250);
  }
  if (await isBulkEditAreaReady(page)) return page.locator("body").first();
  return null;
}

async function isBulkEditAreaReady(page) {
  if (await isVisible(page.locator("#date-from").first()) && await isVisible(page.locator("#date-until").first())) {
    return true;
  }
  if (await isVisible(page.locator("[data-test-id=\"date-from\"]").first()) && await isVisible(page.locator("[data-test-id=\"date-until\"]").first())) {
    return true;
  }
  for (const selector of selectors.bulkEditOpenMarkers) {
    if (await isVisible(page.locator(selector).first())) return true;
  }
  return false;
}

async function detectReusableBulkEditPanel(page) {
  const dateFrom = page.locator("#date-from, [data-test-id=\"date-from\"]").first();
  const dateUntil = page.locator("#date-until, [data-test-id=\"date-until\"]").first();
  const priceInput = page.locator("#price-input-0").first();
  if (await isVisible(dateFrom) && await isVisible(dateUntil) && await priceInput.count().catch(() => 0) > 0) {
    return page.locator("body").first();
  }
  return null;
}

async function waitForFirstVisible(scope, selectorList, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectorList) {
      const locator = scope.locator(selector).first();
      if (await isVisible(locator)) return locator;
    }
    await waitOnScope(scope, 250);
  }
  return null;
}

async function clickLocator(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ timeout: 3000 });
}

async function waitOnScope(scope, ms) {
  if (scope && typeof scope.waitForTimeout === "function") {
    await scope.waitForTimeout(ms);
    return;
  }
  const page = scope && typeof scope.page === "function" ? scope.page() : null;
  if (page && typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectBulkEditDiagnostics(page, bulkEditButtonFound) {
  return {
    bulkEditButtonFound,
    currentUrl: safePageUrl(page),
    visibleTexts: await collectVisibleTexts(page),
    dateFromVisible: await isVisible(page.locator("#date-from, [data-test-id=\"date-from\"]").first()),
    dateUntilVisible: await isVisible(page.locator("#date-until, [data-test-id=\"date-until\"]").first()),
    weekdaysSelectorVisible: await isVisible(page.locator("[data-test-id=\"weekdays-selector\"]").first()),
    pricesAccordionVisible: await isVisible(page.locator("button[data-test-id=\"accordion\"]:has-text(\"Prices\"), button:has-text(\"Prices\")").first()),
    priceSelectVisible: await isVisible(page.locator("select#price-select-0").first()),
    priceInputVisible: await isVisible(page.locator("input#price-input-0").first())
  };
}

async function collectVisibleTexts(page) {
  const texts = await page.locator("button, label, [role=\"button\"], [data-test-id], h1, h2, h3, h4, h5, h6").evaluateAll((nodes) => nodes
    .map((node) => String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim())
    .filter((text) => /Bulk edit|From:?|Up to and including:?|Prices?|Save changes/i.test(text))
    .slice(0, 30)).catch(() => []);
  return Array.from(new Set(texts));
}

function safePageUrl(page) {
  try {
    return page && typeof page.url === "function" ? page.url() : "";
  } catch (_) {
    return "";
  }
}

module.exports = {
  openBulkEdit,
  detectReusableBulkEditPanel
};
