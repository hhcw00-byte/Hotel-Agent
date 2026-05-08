"use strict";

const { selectors } = require("./selectors");
const {
  isVisible,
  safeText,
  throwBookingError
} = require("./mapper");

async function selectDateRange(page, panel, dateRange) {
  await selectDate(page, panel, "start", dateRange.startDate);
  await page.waitForTimeout(200);
  await selectDate(page, panel, "end", dateRange.endDate);
  const state = await readDateRangeState(panel);
  if (state.dateFromValue !== String(dateRange.startDate) || state.dateUntilValue !== String(dateRange.endDate)) {
    throwBookingError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Booking date range input value did not match.", {
      ...state,
      expectedStartDate: String(dateRange.startDate),
      expectedEndDate: String(dateRange.endDate)
    });
  }
  return state;
}

async function selectDate(page, panel, kind, targetDate) {
  const inputTarget = await resolveDateInput(panel, kind);
  if (!inputTarget) {
    throwDateError(kind, targetDate, "Booking date input was not found.", await dateInputDiagnostics(panel, kind, targetDate));
  }

  const input = inputTarget.locator;
  const direct = await setDateInputValue(input, targetDate);
  if (direct.matched) return;

  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ timeout: 3000 });
  const picker = await waitForActiveDatePicker(page);
  const clicked = await clickDateInPicker(page, picker, targetDate);
  if (!clicked) {
    throwDateError(kind, targetDate, `Booking date cell not found: ${targetDate}`, {
      ...(await dateInputDiagnostics(panel, kind, targetDate, inputTarget.selector, direct.lastReadValue)),
      ...(await dateDiagnostics(page, targetDate))
    });
  }

  const matched = await waitForDateEcho(input, targetDate);
  if (!matched) {
    throwDateError(kind, targetDate, `Booking date echo did not match: ${targetDate}`, {
      ...(await dateInputDiagnostics(panel, kind, targetDate, inputTarget.selector, await readInputValue(input))),
      ...(await dateDiagnostics(page, targetDate))
    });
  }
}

async function resolveDateInput(panel, kind) {
  const list = kind === "start" ? selectors.startDateInput : selectors.endDateInput;
  for (const selector of list) {
    const locator = panel.locator(selector).first();
    if (await isVisible(locator)) return { locator, selector };
  }
  const inputs = panel.locator("input");
  const count = await inputs.count().catch(() => 0);
  const fallbackIndex = kind === "start" ? 0 : 1;
  const fallback = inputs.nth(fallbackIndex);
  return count > fallbackIndex && await isVisible(fallback)
    ? { locator: fallback, selector: `input:nth-visible(${fallbackIndex})` }
    : null;
}

async function setDateInputValue(input, targetDate) {
  let lastReadValue = "";
  try {
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click({ timeout: 3000 }).catch(() => {});
    await input.focus({ timeout: 3000 }).catch(() => {});
    await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await input.press("Backspace").catch(() => {});
    await input.evaluate((node, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (setter && setter.set) setter.set.call(node, String(value));
      else node.value = String(value);
      const event = typeof InputEvent === "function"
        ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) })
        : new Event("input", { bubbles: true });
      node.dispatchEvent(event);
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    }, targetDate);
    await input.blur().catch(() => {});
    await input.press("Enter").catch(() => {});
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      lastReadValue = await readInputValue(input);
      if (String(lastReadValue || "").trim() === String(targetDate)) return { matched: true, lastReadValue };
      await input.page().waitForTimeout(150);
    }
  } catch (_) {}
  return { matched: false, lastReadValue };
}

async function waitForActiveDatePicker(page) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const picker = await getActiveDatePicker(page);
    if (picker) return picker;
    await page.waitForTimeout(150);
  }
  return page.locator("body").first();
}

async function getActiveDatePicker(page) {
  for (const selector of selectors.datePicker) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const locator = locators.nth(index);
      if (!await isVisible(locator)) continue;
      const klass = await locator.evaluate((node) => String(node.className || "")).catch(() => "");
      if (/hidden|leave|closing/i.test(klass)) continue;
      const text = await safeText(locator);
      if (/\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|月|年/i.test(text)) return locator;
    }
  }
  return null;
}

async function clickDateInPicker(page, picker, targetDate) {
  const selector = [
    `td[title="${targetDate}"]:not([aria-disabled="true"])`,
    `[data-date="${targetDate}"]:not([aria-disabled="true"])`,
    `button[aria-label*="${targetDate}"]:not([disabled])`,
    `[aria-label*="${targetDate}"]:not([aria-disabled="true"])`
  ].join(",");

  for (let step = 0; step < 14; step += 1) {
    const cell = picker.locator(selector).first();
    if (await isVisible(cell)) {
      const inner = cell.locator("button, [role=\"button\"], span, div").first();
      const target = await isVisible(inner) ? inner : cell;
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.click({ timeout: 3000 });
      return true;
    }
    const next = await firstVisible(picker, selectors.nextMonthButton);
    if (!next) break;
    await next.click({ timeout: 2000 });
    await page.waitForTimeout(200);
    picker = await getActiveDatePicker(page) || picker;
  }
  return false;
}

async function waitForDateEcho(input, targetDate) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const value = await readInputValue(input);
    if (dateTextMatches(value, targetDate)) return true;
    await input.page().waitForTimeout(150);
  }
  return false;
}

async function readDateRangeState(panel) {
  return {
    dateFromValue: await readInputBySelector(panel, "#date-from, [data-test-id=\"date-from\"]"),
    dateUntilValue: await readInputBySelector(panel, "#date-until, [data-test-id=\"date-until\"]")
  };
}

async function readInputBySelector(panel, selector) {
  return panel.locator(selector).first().inputValue().catch(() => "");
}

async function firstVisible(scope, selectorList) {
  for (const selector of selectorList) {
    const locator = scope.locator(selector).first();
    if (await isVisible(locator)) return locator;
  }
  return null;
}

async function readInputValue(locator) {
  return locator.inputValue().catch(async () => safeText(locator));
}

function dateTextMatches(value, targetDate) {
  const raw = String(value || "");
  const lowered = raw.toLowerCase();
  const compact = raw.replace(/\s+/g, "");
  const [year, month, day] = String(targetDate || "").split("-");
  if (!year || !month || !day) return false;
  const monthName = monthNameFor(Number(month));
  const shortMonth = monthName.slice(0, 3);
  return compact.includes(targetDate)
    || compact.includes(`${Number(day)}/${Number(month)}/${year}`)
    || compact.includes(`${Number(month)}/${Number(day)}/${year}`)
    || compact.includes(`${year}-${Number(month)}-${Number(day)}`)
    || compact.includes(`${year}\u5e74${Number(month)}\u6708${Number(day)}\u65e5`)
    || lowered.includes(`${monthName} ${Number(day)}, ${year}`.toLowerCase())
    || lowered.includes(`${Number(day)} ${monthName} ${year}`.toLowerCase())
    || lowered.includes(`${shortMonth} ${Number(day)}, ${year}`.toLowerCase())
    || lowered.includes(`${Number(day)} ${shortMonth} ${year}`.toLowerCase());
}

function monthNameFor(month) {
  return [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ][month] || "";
}

async function dateDiagnostics(page, targetDate) {
  const picker = await getActiveDatePicker(page);
  const titles = picker
    ? await picker.locator("td[title], [data-date], [aria-label]").evaluateAll((nodes) => nodes.slice(0, 30).map((node) => node.getAttribute("title") || node.getAttribute("data-date") || node.getAttribute("aria-label") || ""))
      .catch(() => [])
    : [];
  return {
    targetDate,
    activeDropdownFound: Boolean(picker),
    candidateDateTitles: titles
  };
}

async function dateInputDiagnostics(panel, kind, targetDate, inputSelector = "", lastReadValue = "") {
  return {
    targetDate,
    inputSelector: inputSelector || (kind === "start" ? "#date-from, [data-test-id=\"date-from\"]" : "#date-until, [data-test-id=\"date-until\"]"),
    lastReadValue,
    dateFromVisible: await isVisible(panel.locator("#date-from, [data-test-id=\"date-from\"]").first()),
    dateUntilVisible: await isVisible(panel.locator("#date-until, [data-test-id=\"date-until\"]").first())
  };
}

function throwDateError(kind, targetDate, message, diagnostics = {}) {
  throwBookingError("DATE_RANGE_NOT_MATCHED", "select_date_range", message, {
    targetDate,
    dateKind: kind,
    ...diagnostics
  });
}

module.exports = {
  selectDateRange
};
