"use strict";

const { selectors } = require("./selectors");
const { isVisible, safeText, throwBookingError } = require("./mapper");

async function selectDateRange(page, panel, dateRange = {}) {
  const expectedStartDate = String(dateRange.startDate || "").trim();
  const expectedEndDate = String(dateRange.endDate || "").trim();
  await selectDateByPicker(page, panel, "start", expectedStartDate);
  await page.waitForTimeout(200);
  if (expectedStartDate === expectedEndDate) {
    const afterStart = await readDateRangeState(panel);
    if (dateTextMatches(afterStart.startDate, expectedStartDate) && dateTextMatches(afterStart.endDate, expectedEndDate)) {
      return {
        expectedStartDate,
        expectedEndDate,
        actualDateReadback: afterStart
      };
    }
  }
  await selectDateByPicker(page, panel, "end", expectedEndDate);
  const actualDateReadback = await readDateRangeState(panel);
  if (!dateTextMatches(actualDateReadback.startDate, expectedStartDate) || !dateTextMatches(actualDateReadback.endDate, expectedEndDate)) {
    throwBookingError("DATE_READBACK_MISMATCH", "select_date_range", "Booking date range readback did not match.", await dateDiagnostics(page, panel, {
      segmentIndex: dateRange.segmentIndex,
      expectedStartDate,
      expectedEndDate,
      actualDateReadback,
      failedStep: "date_readback_mismatch"
    }));
  }
  return {
    expectedStartDate,
    expectedEndDate,
    actualDateReadback
  };
}

async function selectDateByPicker(page, panel, kind, targetDate) {
  const inputTarget = await resolveDateInput(panel, kind);
  if (!inputTarget) {
    throwBookingError("DATE_INPUT_NOT_FOUND", "select_date_range", `Booking ${kind} date input was not found.`, await dateDiagnostics(page, panel, {
      targetDate,
      dateKind: kind,
      failedStep: `${kind}_date_input_not_found`
    }));
  }

  await inputTarget.locator.scrollIntoViewIfNeeded().catch(() => {});
  await inputTarget.locator.click({ timeout: 3000 });
  const picker = await waitForActiveDatePicker(page);
  if (!picker) {
    throwBookingError("DATE_PICKER_NOT_OPEN", "select_date_range", `Booking ${kind} date picker did not open.`, await dateDiagnostics(page, panel, {
      targetDate,
      dateKind: kind,
      inputSelector: inputTarget.selector,
      failedStep: `${kind}_date_picker_not_open`
    }));
  }

  const clicked = await clickDateInPicker(page, picker, targetDate);
  if (!clicked) {
    throwBookingError("DATE_CELL_NOT_FOUND", "select_date_range", `Booking date cell not found: ${targetDate}`, await dateDiagnostics(page, panel, {
      targetDate,
      dateKind: kind,
      inputSelector: inputTarget.selector,
      failedStep: `${kind}_date_cell_not_found`
    }));
  }

  const matched = await waitForDateEcho(inputTarget.locator, targetDate);
  if (!matched) {
    throwBookingError("DATE_READBACK_MISMATCH", "select_date_range", `Booking ${kind} date readback did not match: ${targetDate}`, await dateDiagnostics(page, panel, {
      targetDate,
      dateKind: kind,
      inputSelector: inputTarget.selector,
      lastReadValue: await readInputValue(inputTarget.locator),
      failedStep: `${kind}_date_readback_mismatch`
    }));
  }
}

async function resolveDateInput(panel, kind) {
  const selectorsToTry = kind === "start" ? selectors.startDateInput : selectors.endDateInput;
  for (const selector of selectorsToTry || []) {
    const locator = panel.locator(selector).first();
    if (await isVisible(locator)) return { locator, selector };
  }
  const inputs = panel.locator("input");
  const fallbackIndex = kind === "start" ? 0 : 1;
  const fallback = inputs.nth(fallbackIndex);
  return await isVisible(fallback) ? { locator: fallback, selector: `input:nth-visible(${fallbackIndex})` } : null;
}

async function waitForActiveDatePicker(page) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const picker = await getActiveDatePicker(page);
    if (picker) return picker;
    await page.waitForTimeout(150);
  }
  return null;
}

async function getActiveDatePicker(page) {
  for (const selector of selectors.datePicker || []) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const locator = locators.nth(index);
      if (!await isVisible(locator)) continue;
      const klass = await locator.evaluate((node) => String(node.className || "")).catch(() => "");
      if (/hidden|closing|leave/i.test(klass)) continue;
      const text = await safeText(locator);
      if (/\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\u5e74|\u6708/i.test(text)) return locator;
    }
  }
  return null;
}

async function clickDateInPicker(page, picker, targetDate) {
  const direct = await findDateCell(picker, targetDate);
  if (direct) {
    await clickDateCell(direct);
    return true;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = await firstVisible(picker, selectors.nextMonthButton);
    if (!next) break;
    await next.click({ timeout: 2000 });
    await page.waitForTimeout(200);
    picker = await getActiveDatePicker(page) || picker;
    const cell = await findDateCell(picker, targetDate);
    if (cell) {
      await clickDateCell(cell);
      return true;
    }
  }
  return false;
}

async function findDateCell(picker, targetDate) {
  const selector = [
    `td[title="${targetDate}"]:not([aria-disabled="true"])`,
    `[data-date="${targetDate}"]:not([aria-disabled="true"])`,
    `[data-day="${targetDate}"]:not([aria-disabled="true"])`,
    `button[aria-label*="${targetDate}"]:not([disabled])`,
    `[aria-label*="${targetDate}"]:not([aria-disabled="true"])`
  ].join(",");
  const cell = picker.locator(selector).first();
  if (await isVisible(cell)) return cell;
  return findDateCellByDayText(picker, targetDate);
}

async function findDateCellByDayText(picker, targetDate) {
  const parts = parseIsoDate(targetDate);
  if (!parts) return null;
  const pickerText = await safeText(picker);
  if (!hasTargetMonthContext(pickerText, parts)) return null;
  const candidates = picker.locator("td, button, [role=\"button\"], [data-date], [data-day], [aria-label]");
  const count = Math.min(await candidates.count().catch(() => 0), 160);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await isVisible(candidate)) continue;
    const details = await describeDateCandidate(candidate);
    const descriptor = [
      details.text,
      details.title,
      details.dataDate,
      details.dataDay,
      details.ariaLabel
    ].filter(Boolean).join(" ");
    if (isDisabledDateCandidate(details)) continue;
    if (dateTextMatches(descriptor, targetDate)) return candidate;
    if (isLikelyOutsideMonth(details) && !hasTargetMonthContext(descriptor, parts)) continue;
    if (dateTextMatchesDay(details.text, parts.day)) return candidate;
  }
  return null;
}

async function clickDateCell(cell) {
  const inner = cell.locator("button, [role=\"button\"], span, div").first();
  const target = await isVisible(inner) ? inner : cell;
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout: 3000 });
}

async function waitForDateEcho(input, targetDate) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (dateTextMatches(await readInputValue(input), targetDate)) return true;
    await input.page().waitForTimeout(150);
  }
  return false;
}

async function readDateRangeState(panel) {
  return {
    startDate: await readInputBySelector(panel, "#date-from, [data-test-id=\"date-from\"]"),
    endDate: await readInputBySelector(panel, "#date-until, [data-test-id=\"date-until\"]")
  };
}

async function readInputBySelector(panel, selector) {
  return panel.locator(selector).first().inputValue().catch(() => "");
}

async function readInputValue(locator) {
  return locator.inputValue().catch(async () => safeText(locator));
}

async function firstVisible(scope, selectorList) {
  for (const selector of selectorList || []) {
    const locator = scope.locator(selector).first();
    if (await isVisible(locator)) return locator;
  }
  return null;
}

function dateTextMatches(value, targetDate) {
  const raw = String(value || "").trim();
  const target = String(targetDate || "").trim();
  if (!raw || !target) return false;
  if (raw === target || raw.includes(target)) return true;
  const [year, month, day] = target.split("-");
  if (!year || !month || !day) return false;
  const compact = raw.replace(/\s+/g, "").toLowerCase();
  const monthName = monthNameFor(Number(month));
  const shortMonth = monthName.slice(0, 3);
  return compact.includes(`${year}-${Number(month)}-${Number(day)}`)
    || compact.includes(`${Number(day)}/${Number(month)}/${year}`)
    || compact.includes(`${Number(month)}/${Number(day)}/${year}`)
    || compact.includes(`${year}\u5e74${Number(month)}\u6708${Number(day)}\u65e5`)
    || compact.includes(`${monthName}${Number(day)},${year}`.toLowerCase())
    || compact.includes(`${Number(day)}${monthName}${year}`.toLowerCase())
    || compact.includes(`${shortMonth}${Number(day)},${year}`.toLowerCase())
    || compact.includes(`${Number(day)}${shortMonth}${year}`.toLowerCase());
}

function dateTextMatchesDay(value, day) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const number = Number(day);
  if (!Number.isFinite(number)) return false;
  return raw === String(number)
    || raw === String(day).padStart(2, "0")
    || new RegExp(`(^|\\D)0?${number}(\\D|$)`).test(raw);
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const month = Number(match[2]);
  return {
    year: match[1],
    month,
    monthPadded: match[2],
    day: match[3],
    monthName: monthNameFor(month),
    shortMonth: monthNameFor(month).slice(0, 3)
  };
}

function hasTargetMonthContext(value, parts) {
  const compact = String(value || "").replace(/\s+/g, "").toLowerCase();
  if (!compact) return false;
  return compact.includes(`${parts.year}-${parts.monthPadded}`)
    || compact.includes(`${parts.year}\u5e74${parts.month}\u6708`)
    || compact.includes(`${parts.month}\u6708${parts.year}`)
    || compact.includes(`${parts.monthName}${parts.year}`.toLowerCase())
    || compact.includes(`${parts.shortMonth}${parts.year}`.toLowerCase())
    || compact.includes(`${parts.year}${parts.monthName}`.toLowerCase())
    || compact.includes(`${parts.year}${parts.shortMonth}`.toLowerCase());
}

async function describeDateCandidate(locator) {
  const attr = async (name) => locator.getAttribute(name).catch(() => "");
  return {
    text: String(await safeText(locator)).replace(/\s+/g, " ").trim(),
    title: await attr("title"),
    dataDate: await attr("data-date"),
    dataDay: await attr("data-day"),
    ariaLabel: await attr("aria-label"),
    ariaDisabled: await attr("aria-disabled"),
    disabled: await attr("disabled"),
    className: await attr("class")
  };
}

function isDisabledDateCandidate(details) {
  return details.disabled !== null && details.disabled !== ""
    || String(details.ariaDisabled || "").toLowerCase() === "true"
    || /disabled|unavailable/i.test(String(details.className || ""));
}

function isLikelyOutsideMonth(details) {
  return /outside|other|adjacent|muted/i.test(String(details.className || ""));
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

async function dateDiagnostics(page, panel, extra = {}) {
  const picker = await getActiveDatePicker(page);
  const candidateDateTitles = picker
    ? await picker.locator("td[title], [data-date], [data-day], [aria-label]").evaluateAll((nodes) => nodes.slice(0, 30).map((node) => node.getAttribute("title") || node.getAttribute("data-date") || node.getAttribute("data-day") || node.getAttribute("aria-label") || ""))
      .catch(() => [])
    : [];
  const candidateDateTexts = picker ? await collectDateCandidateSamples(picker) : [];
  return {
    platformCode: "booking",
    segmentIndex: extra.segmentIndex,
    expectedStartDate: extra.expectedStartDate || "",
    expectedEndDate: extra.expectedEndDate || "",
    actualDateReadback: extra.actualDateReadback || await readDateRangeState(panel),
    targetDate: extra.targetDate || "",
    dateKind: extra.dateKind || "",
    inputSelector: extra.inputSelector || "",
    lastReadValue: extra.lastReadValue || "",
    activeDropdownFound: Boolean(picker),
    candidateDateTitles,
    candidateDateTexts,
    currentUrl: page.url ? page.url() : "",
    bodyTextSample: String(await safeText(page.locator("body").first()).catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500),
    failedStep: extra.failedStep || ""
  };
}

async function collectDateCandidateSamples(picker) {
  const candidates = picker.locator("td, button, [role=\"button\"], [data-date], [data-day], [aria-label]");
  const count = Math.min(await candidates.count().catch(() => 0), 30);
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const details = await describeDateCandidate(candidates.nth(index));
    samples.push({
      text: details.text,
      title: details.title || "",
      dataDate: details.dataDate || "",
      dataDay: details.dataDay || "",
      ariaLabel: details.ariaLabel || "",
      className: details.className || ""
    });
  }
  return samples;
}

module.exports = {
  selectDateRange,
  readDateRangeState,
  dateTextMatches
};
