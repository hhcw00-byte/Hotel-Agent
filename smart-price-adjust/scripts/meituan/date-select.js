"use strict";

const { SELECTORS } = require("./selectors");

async function selectDateRange(page, segment) {
  const start = parseDate(segment && segment.startDate);
  const end = parseDate(segment && segment.endDate);
  if (!start.valid || !end.valid) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Meituan date range is invalid.", {
      startDate: segment && segment.startDate,
      endDate: segment && segment.endDate
    });
  }

  assertTargetPage(page, "before_date_select");
  await openDatePanel(page);
  await selectBoundaryDate(page, 0, start);
  await selectBoundaryDate(page, 1, end);

  const readback = await waitDateReadback(page, start.raw, end.raw, 1600);
  if (!readback.matched) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Meituan date range readback did not match.", {
      targetStartDate: start.raw,
      targetEndDate: end.raw,
      readback
    });
  }

  const closeResult = await closeDatePanelSafely(page);
  if (!closeResult.closed) {
    throwMeituanError("DATE_PANEL_STUCK", "select_date_range", "Meituan date panel did not close after date selection.", {
      closeResult,
      readback
    });
  }

  assertTargetPage(page, "after_date_select");
  return {
    startDate: start.raw,
    endDate: end.raw,
    dateRangeApplied: true,
    dateRangeReadbackMatched: true,
    datePanelClosed: true,
    closeAction: closeResult.action,
    readback
  };
}

async function openDatePanel(page) {
  if (await isDatePanelVisible(page)) return;

  const input = page.locator(SELECTORS.dateRangeInput).first();
  if (!(await input.count().catch(() => 0))) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Meituan date range input was not found.");
  }
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ force: true }).catch(async () => {
    const control = page.locator(SELECTORS.dateRangeControl).first();
    await control.click({ force: true });
  });

  if (!(await waitDatePanelVisible(page, 1500))) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Meituan date panel did not open.");
  }
}

async function selectBoundaryDate(page, inputIndex, dateInfo) {
  await focusDateInput(page, inputIndex);
  if (!(await ensureCalendarMonth(page, dateInfo.year, dateInfo.month))) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Meituan calendar month not found: ${dateInfo.raw}`, {
      targetDate: dateInfo.raw
    });
  }

  const clicked = await clickDateCell(page, dateInfo);
  if (!clicked) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Meituan date cell not found: ${dateInfo.raw}`, {
      targetDate: dateInfo.raw
    });
  }
  await page.waitForTimeout(220);
  assertTargetPage(page, `after_${inputIndex === 0 ? "start" : "end"}_date_click`);
}

async function focusDateInput(page, inputIndex) {
  const inputs = page.locator(SELECTORS.dateRangeInput);
  if ((await inputs.count().catch(() => 0)) <= inputIndex) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Meituan date input not found: index=${inputIndex}`);
  }
  const input = inputs.nth(inputIndex);
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ force: true }).catch(async () => {
    await input.focus().catch(() => {});
  });
  if (!(await waitDatePanelVisible(page, 1000))) {
    await openDatePanel(page);
  }
}

async function ensureCalendarMonth(page, year, month) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const headers = await readCalendarHeaders(page);
    if (headers.some((item) => item.year === year && item.month === month)) return true;
    const first = headers[0];
    if (!first || !first.year || !first.month) return false;
    const monthDiff = (year - first.year) * 12 + (month - first.month);
    const switcher = page.locator(monthDiff >= 0 ? SELECTORS.dateMonthNext : SELECTORS.dateMonthPrev).first();
    if (!(await switcher.count().catch(() => 0))) return false;
    await switcher.click({ force: true }).catch(() => {});
    await page.waitForTimeout(180);
  }
  return false;
}

async function clickDateCell(page, dateInfo) {
  return page.locator(SELECTORS.dateCalendar).evaluateAll((calendars, target) => {
    const visible = (node) => Boolean(node && (node.offsetParent || node.getClientRects().length));
    for (const calendar of calendars.filter(visible)) {
      const year = readNumber(calendar, [".mtd-date-calendar-year-btn", "[class*='year-btn']", "[class*='calendar-year']"]);
      const month = readNumber(calendar, [".mtd-date-calendar-month-btn", "[class*='month-btn']", "[class*='calendar-month']"]);
      if (year !== target.year || month !== target.month) continue;

      const cells = Array.from(calendar.querySelectorAll(".mtd-date-panel-data-wrapper .mtd-date-panel-data, [class*='date-panel-data-wrapper'] [class*='date-panel-data']"))
        .filter((cell) => visible(cell) && isEnabledDateCell(cell));
      const match = cells.find((cell) => readCellDay(cell) === String(target.day));
      if (!match) continue;
      match.scrollIntoView({ block: "center", inline: "center" });
      match.click();
      return true;
    }
    return false;

    function readNumber(root, selectors) {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        const value = Number(String(node && node.textContent || "").replace(/\D+/g, ""));
        if (value) return value;
      }
      return 0;
    }

    function readCellDay(cell) {
      const textNode = cell.querySelector(".mtd-date-cell-text, [class*='date-cell-text']");
      return String(textNode ? textNode.textContent : cell.textContent || "").replace(/\D+/g, "").trim();
    }

    function isEnabledDateCell(cell) {
      const className = String(cell.className || "");
      const wrapper = cell.closest(".mtd-date-panel-data-wrapper, [class*='date-panel-data-wrapper']");
      const wrapperClass = String(wrapper && wrapper.className || "");
      if (/\bdisabled\b|\bnot-current-month\b/.test(`${className} ${wrapperClass}`)) return false;
      return String(cell.getAttribute("aria-disabled") || "") !== "true";
    }
  }, dateInfo).catch(() => false);
}

async function closeDatePanelSafely(page) {
  if (!(await isDatePanelVisible(page))) return { closed: true, action: "already_closed" };

  const confirm = await findDateConfirmButton(page);
  if (confirm) {
    await confirm.click({ force: true }).catch(() => {});
    if (await waitDatePanelHidden(page, 1200)) return { closed: true, action: "confirm_button" };
  }

  await page.keyboard.press("Escape").catch(() => {});
  if (await waitDatePanelHidden(page, 1000)) return { closed: true, action: "escape" };

  return {
    closed: false,
    action: confirm ? "confirm_button_then_escape" : "escape"
  };
}

async function findDateConfirmButton(page) {
  const panel = page.locator(SELECTORS.datePanel).filter({ has: page.locator(SELECTORS.dateCalendar) }).first();
  const buttons = panel.locator("button, [role='button'], .mtd-button");
  const total = Math.min(await buttons.count().catch(() => 0), 20);
  const targets = ["\u786e\u5b9a", "\u5b8c\u6210", "\u786e\u8ba4", "OK", "Ok", "ok"];
  for (let index = 0; index < total; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const text = String(await button.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (targets.some((target) => text === target || text.includes(target))) return button;
  }
  return null;
}

async function waitDateReadback(page, startDate, endDate, timeoutMs) {
  const started = Date.now();
  let snapshot = await readDateInputs(page);
  while (Date.now() - started < timeoutMs) {
    snapshot = await readDateInputs(page);
    if (snapshot.start === normalizeDate(startDate) && snapshot.end === normalizeDate(endDate)) {
      return { ...snapshot, matched: true };
    }
    await page.waitForTimeout(200);
  }
  return { ...snapshot, matched: false };
}

async function readDateInputs(page) {
  const values = await page.locator(SELECTORS.dateRangeInput).evaluateAll((inputs) => inputs
    .filter((input) => Boolean(input && (input.offsetParent || input.getClientRects().length)))
    .slice(0, 2)
    .map((input) => String(input.value || input.getAttribute("value") || "").trim())).catch(() => []);
  return {
    values,
    start: normalizeDate(values[0]),
    end: normalizeDate(values[1]),
    raw: values.join(" ~ ")
  };
}

async function readCalendarHeaders(page) {
  return page.locator(SELECTORS.dateCalendar).evaluateAll((calendars) => calendars
    .filter((calendar) => Boolean(calendar && (calendar.offsetParent || calendar.getClientRects().length)))
    .map((calendar) => {
      const read = (selectors) => {
        for (const selector of selectors) {
          const node = calendar.querySelector(selector);
          if (node && node.textContent) return String(node.textContent).trim();
        }
        return "";
      };
      return {
        year: Number(read([".mtd-date-calendar-year-btn", "[class*='year-btn']", "[class*='calendar-year']"]).replace(/\D+/g, "")),
        month: Number(read([".mtd-date-calendar-month-btn", "[class*='month-btn']", "[class*='calendar-month']"]).replace(/\D+/g, ""))
      };
    })).catch(() => []);
}

async function isDatePanelVisible(page) {
  return page.locator(SELECTORS.datePanel).evaluateAll((panels) => panels.some((panel) => {
    if (!panel || !panel.getClientRects().length) return false;
    const style = window.getComputedStyle(panel);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  })).catch(() => false);
}

async function waitDatePanelVisible(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isDatePanelVisible(page)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function waitDatePanelHidden(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isDatePanelVisible(page))) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

function assertTargetPage(page, stage) {
  const url = String(page && typeof page.url === "function" ? page.url() : "");
  if (!url.toLowerCase().includes("/ebooking/merchant/product/batch-price")) {
    throwMeituanError("TARGET_PAGE_LEFT", "page_guard", `Meituan target page left during date selection: ${url}`, { stage, url });
  }
}

function parseDate(value) {
  const raw = normalizeDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return {
    raw,
    valid: Boolean(match),
    year: match ? Number(match[1]) : 0,
    month: match ? Number(match[2]) : 0,
    day: match ? Number(match[3]) : 0
  };
}

function normalizeDate(value) {
  const match = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(String(value || "").trim());
  if (!match) return "";
  return [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-");
}

function throwMeituanError(code, stage, message, diagnostics = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.stage = stage;
  error.diagnostics = diagnostics;
  throw error;
}

module.exports = {
  selectDateRange
};
