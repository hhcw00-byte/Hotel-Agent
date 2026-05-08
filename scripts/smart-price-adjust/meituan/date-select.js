"use strict";

const { SELECTORS } = require("./selectors");

async function selectDateRange(page, segment, options = {}) {
  const start = parseDate(segment && segment.startDate);
  const end = parseDate(segment && segment.endDate);
  if (!start.valid || !end.valid) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Meituan date range is invalid.", {
      startDate: segment && segment.startDate,
      endDate: segment && segment.endDate
    });
  }

  assertTargetPage(page, "before_date_select");
  await openDatePanel(page, options.pageReady);
  const startClick = await selectBoundaryDate(page, 0, start, start, end);
  const endClick = await selectBoundaryDate(page, 1, end, start, end);

  const readback = await waitDateReadback(page, start.raw, end.raw, 1600);
  if (!readback.matched) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Meituan date range readback did not match.", {
      expectedStartDate: start.raw,
      expectedEndDate: end.raw,
      actualInputValue: readback.raw,
      panelStillVisible: await isDatePanelVisible(page),
      clickedDateTexts: [startClick.text, endClick.text].filter(Boolean),
      clickedDateAttributes: [startClick.attributes, endClick.attributes].filter(Boolean),
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
    datePanelVisibleAfterClose: closeResult.datePanelVisibleAfterClose,
    readback
  };
}

async function openDatePanel(page, pageReady = {}) {
  if (await isDatePanelVisible(page)) return;

  const clickAttempts = [];
  for (const action of ["input", "control", "mouse"]) {
    const attempt = await clickDateOpenTarget(page, action);
    attempt.datePanelVisibleAfterClick = await waitDatePanelVisible(page, 700);
    clickAttempts.push(attempt);
    if (attempt.datePanelVisibleAfterClick) return;
  }

  throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Meituan date panel did not open.", {
    ...(await collectDateOpenDiagnostics(page, pageReady)),
    clickAttempts,
    clickedTargetDescriptions: clickAttempts.map((item) => item.targetDescription).filter(Boolean)
  });
}

async function selectBoundaryDate(page, inputIndex, dateInfo, start, end) {
  await focusDateInput(page, inputIndex);
  if (!(await ensureCalendarMonth(page, dateInfo.year, dateInfo.month))) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Meituan calendar month not found: ${dateInfo.raw}`, {
      ...(await collectDateCellDiagnostics(page, dateInfo, [], start, end))
    });
  }

  const cellResult = await clickDateCellWithPanelScroll(page, dateInfo, start, end);
  if (!cellResult.clicked) {
    throwMeituanError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Meituan date cell not found: ${dateInfo.raw}`, {
      ...cellResult.diagnostics
    });
  }
  await page.waitForTimeout(220);
  assertTargetPage(page, `after_${inputIndex === 0 ? "start" : "end"}_date_click`);
  return cellResult;
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

async function clickDateOpenTarget(page, action) {
  const selector = action === "input" ? SELECTORS.dateRangeInput : SELECTORS.dateRangeControl;
  const target = page.locator(selector).first();
  const attempt = { action, selector, clicked: false, targetDescription: "" };
  try {
    if (!(await target.count().catch(() => 0))) {
      attempt.error = "target_not_found";
      return attempt;
    }
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const box = await target.boundingBox().catch(() => null);
    attempt.targetDescription = `${action}:${selector}`;
    attempt.dateControlBox = box;
    if (action === "mouse" && box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await target.click({ force: true });
    }
    attempt.clicked = true;
  } catch (error) {
    attempt.error = error && error.message ? error.message : String(error);
  }
  return attempt;
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

async function clickDateCellWithPanelScroll(page, dateInfo, start, end) {
  const scrollAttempts = [];
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const result = await clickDateCell(page, dateInfo);
    if (result.clicked) return { ...result, scrollAttempts };
    const scroll = await scrollDatePanel(page);
    scrollAttempts.push({ attempt, ...scroll });
    if (!scroll.scrolled) break;
    await page.waitForTimeout(180);
  }
  return {
    clicked: false,
    diagnostics: await collectDateCellDiagnostics(page, dateInfo, scrollAttempts, start, end)
  };
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
      const match = cells.find((cell) => cellMatchesTargetDate(cell, target));
      if (!match) continue;
      match.scrollIntoView({ block: "center", inline: "center" });
      match.click();
      return {
        clicked: true,
        text: String(match.textContent || "").replace(/\s+/g, " ").trim(),
        attributes: readCellAttributes(match)
      };
    }
    return { clicked: false };

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
      const text = String(textNode ? textNode.textContent : cell.textContent || "");
      const exactDay = new RegExp(`(^|\\D)0?${target.day}(\\D|$)`);
      if (exactDay.test(text)) return String(target.day);
      return text.replace(/\D+/g, "").trim();
    }

    function cellMatchesTargetDate(cell, target) {
      const fullDate = `${target.year}-${String(target.month).padStart(2, "0")}-${String(target.day).padStart(2, "0")}`;
      const fullDateSlash = fullDate.replace(/-/g, "/");
      const attrs = ["data-date", "data-day", "aria-label", "title", "value"];
      if (attrs.some((attr) => {
        const value = String(cell.getAttribute(attr) || "");
        return value.includes(fullDate) || value.includes(fullDateSlash);
      })) return true;
      return readCellDay(cell) === String(target.day);
    }

    function readCellAttributes(cell) {
      return ["data-date", "data-day", "aria-label", "title", "value"].reduce((result, name) => {
        const value = cell.getAttribute(name);
        if (value) result[name] = value;
        return result;
      }, {});
    }

    function isEnabledDateCell(cell) {
      const className = String(cell.className || "");
      const wrapper = cell.closest(".mtd-date-panel-data-wrapper, [class*='date-panel-data-wrapper']");
      const wrapperClass = String(wrapper && wrapper.className || "");
      if (/\bdisabled\b|\bnot-current-month\b/.test(`${className} ${wrapperClass}`)) return false;
      return String(cell.getAttribute("aria-disabled") || "") !== "true";
    }
  }, dateInfo).catch((error) => ({
    clicked: false,
    error: error && error.message ? error.message : String(error)
  }));
}

async function scrollDatePanel(page) {
  return page.locator(SELECTORS.datePanel).evaluateAll((panels) => {
    const visible = (node) => Boolean(node && (node.offsetParent || node.getClientRects().length));
    const panel = panels.find((item) => visible(item) && item.querySelector(".mtd-date-calendar, [class*='date-calendar']"));
    if (!panel) return { scrolled: false, reason: "panel_not_found" };
    const candidates = [panel, ...Array.from(panel.querySelectorAll("*"))]
      .filter((node) => visible(node) && node.scrollHeight > node.clientHeight + 8)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    const scroller = candidates[0];
    if (!scroller) return { scrolled: false, reason: "scroll_container_not_found" };
    const before = scroller.scrollTop;
    const maxTop = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.min(maxTop, before + Math.max(220, Math.floor(scroller.clientHeight * 0.8)));
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      scrolled: scroller.scrollTop !== before,
      panelScrollTop: scroller.scrollTop,
      panelScrollHeight: scroller.scrollHeight,
      panelClientHeight: scroller.clientHeight
    };
  }).catch((error) => ({
    scrolled: false,
    reason: error && error.message ? error.message : String(error)
  }));
}

async function collectDateCellDiagnostics(page, dateInfo, scrollAttempts = [], start, end) {
  const panelState = await page.locator(SELECTORS.datePanel).evaluateAll((panels) => {
    const visible = (node) => Boolean(node && (node.offsetParent || node.getClientRects().length));
    const panel = panels.find((item) => visible(item) && item.querySelector(".mtd-date-calendar, [class*='date-calendar']"));
    const result = {
      visibleMonthTexts: [],
      visibleDateTexts: [],
      panelTextSample: "",
      panelScrollTop: 0,
      panelScrollHeight: 0,
      panelClientHeight: 0
    };
    if (!panel) return result;
    result.panelTextSample = String(panel.innerText || panel.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
    result.visibleMonthTexts = Array.from(panel.querySelectorAll(".mtd-date-calendar-year-btn, .mtd-date-calendar-month-btn, [class*='year-btn'], [class*='month-btn']"))
      .filter(visible)
      .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 12);
    result.visibleDateTexts = Array.from(panel.querySelectorAll(".mtd-date-panel-data, [class*='date-panel-data']"))
      .filter(visible)
      .map((node) => {
        const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
        const attrs = ["data-date", "data-day", "aria-label", "title"].map((name) => node.getAttribute(name)).filter(Boolean).join("|");
        return attrs ? `${text} ${attrs}`.trim() : text;
      })
      .filter(Boolean)
      .slice(0, 80);
    const scroller = [panel, ...Array.from(panel.querySelectorAll("*"))]
      .filter((node) => visible(node) && node.scrollHeight > node.clientHeight + 8)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    if (scroller) {
      result.panelScrollTop = scroller.scrollTop;
      result.panelScrollHeight = scroller.scrollHeight;
      result.panelClientHeight = scroller.clientHeight;
    }
    return result;
  }, dateInfo).catch(() => ({}));

  return {
    targetDate: dateInfo.raw,
    targetMonth: `${dateInfo.year}-${String(dateInfo.month).padStart(2, "0")}`,
    expectedStartDate: start && start.raw,
    expectedEndDate: end && end.raw,
    actualInputValue: (await readDateInputs(page)).raw,
    panelStillVisible: await isDatePanelVisible(page),
    ...panelState,
    scrollAttempts,
    dateCellSelectorsTried: [
      SELECTORS.dateCell,
      ".mtd-date-cell-text",
      "[data-date]",
      "[data-day]",
      "[aria-label]",
      "[title]"
    ],
    clickedDateTexts: [],
    clickedDateAttributes: [],
    currentUrl: readPageUrl(page),
    activeFrameUrl: readPageUrl(page)
  };
}

async function closeDatePanelSafely(page) {
  if (!(await isDatePanelVisible(page))) return { closed: true, action: "already_closed", datePanelVisibleAfterClose: false };

  const confirm = await findDateConfirmButton(page);
  if (confirm) {
    await confirm.click({ force: true }).catch(() => {});
    if (await waitDatePanelHidden(page, 1200)) return { closed: true, action: "confirm_button", datePanelVisibleAfterClose: false };
  }

  await page.keyboard.press("Escape").catch(() => {});
  if (await waitDatePanelHidden(page, 1000)) return { closed: true, action: "escape", datePanelVisibleAfterClose: false };

  return {
    closed: false,
    action: confirm ? "confirm_button_then_escape" : "escape",
    datePanelVisibleAfterClose: await isDatePanelVisible(page)
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

function readPageUrl(page) {
  try {
    return page && typeof page.url === "function" ? page.url() : "";
  } catch (_) {
    return "";
  }
}

async function collectDateOpenDiagnostics(page, pageReady = {}) {
  const control = page.locator(SELECTORS.dateRangeControl);
  const first = control.first();
  return {
    ...pageReady,
    currentUrl: readPageUrl(page),
    activeFrameUrl: readPageUrl(page),
    dateInputSelectorUsed: SELECTORS.dateRangeInput,
    dateControlSelectorUsed: SELECTORS.dateRangeControl,
    dateInputCount: await page.locator(SELECTORS.dateRangeInput).count().catch(() => 0),
    dateControlCount: await control.count().catch(() => 0),
    dateControlVisibleAfterScroll: await first.isVisible().catch(() => false),
    dateControlBox: await first.boundingBox().catch(() => null),
    datePanelVisibleAfterClick: await isDatePanelVisible(page),
    bodyTextSample: await readBodyTextSample(page)
  };
}

async function readBodyTextSample(page) {
  const text = await page.locator("body").innerText({ timeout: 500 }).catch(() => "");
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
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
