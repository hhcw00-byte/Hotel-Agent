"use strict";

const { throwTripError } = require("./mapper");

const PICKER = ".he-trip-kit-ui-picker";
const PICKER_INPUT = "input";
const DROPDOWN = ".he-trip-kit-ui-picker-dropdown";
const HIDDEN_CLASS = "he-trip-kit-ui-picker-dropdown-hidden";
const LEAVE_CLASS = "he-trip-kit-ui-slide-up-leave";
const LEAVE_ACTIVE_CLASS = "he-trip-kit-ui-slide-up-leave-active";
const DATE_CELL_INNER = ".he-trip-kit-ui-picker-cell-inner";
const NEXT_MONTH = ".he-trip-kit-ui-picker-header-next-btn";
const MONTH_YEAR_LABEL = ".he-trip-kit-ui-select-selection-item";

async function selectDateRange(page, segment) {
  await selectDate(page, 0, segment.startDate);
  await selectDate(page, 1, segment.endDate);
}

async function selectDate(page, pickerIndex, dateText) {
  const input = await findDateInput(page, pickerIndex);
  await input.click();
  let activeDropdown = await waitActiveDatePicker(page, 5000);

  for (let index = 0; index < 12; index += 1) {
    activeDropdown = await waitActiveDatePicker(page, 3000);
    const cell = activeDropdown.locator(buildDateCellSelector(dateText)).first();
    if (await cell.isVisible().catch(() => false)) {
      await clickDateCell(page, cell);
      await waitPickerClosedOrStable(page);
      return;
    }

    const next = activeDropdown.locator(NEXT_MONTH).first();
    if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(150);
  }

  throwTripError(
    "DATE_RANGE_NOT_MATCHED",
    "select_date_range",
    `Trip date not found: ${dateText}`,
    await buildDateDiagnostics(page, dateText)
  );
}

async function findDateInput(page, pickerIndex) {
  const placeholderInputs = page.locator("input[placeholder='Select date']");
  if ((await placeholderInputs.count().catch(() => 0)) > pickerIndex) {
    return placeholderInputs.nth(pickerIndex);
  }

  const pickers = page.locator(PICKER);
  const pickerCount = await pickers.count();
  if (pickerCount > pickerIndex) {
    return pickers.nth(pickerIndex).locator(PICKER_INPUT).first();
  }
  if (pickerCount === 1) {
    const inputs = pickers.first().locator(PICKER_INPUT);
    if ((await inputs.count()) > pickerIndex) return inputs.nth(pickerIndex);
  }
  throwTripError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Trip date picker not found: index=${pickerIndex}`);
}

async function waitActiveDatePicker(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const picker = await getActiveDatePicker(page);
    if (picker) return picker;
    await page.waitForTimeout(100);
  }
  throwTripError(
    "DATE_RANGE_NOT_MATCHED",
    "select_date_range",
    "Trip active date picker not found.",
    await buildDateDiagnostics(page, "")
  );
}

async function getActiveDatePicker(page) {
  const dropdowns = page.locator(DROPDOWN);
  const count = Math.min(await dropdowns.count().catch(() => 0), 8);
  for (let index = 0; index < count; index += 1) {
    const dropdown = dropdowns.nth(index);
    if (!(await dropdown.isVisible().catch(() => false))) continue;
    const active = await dropdown.evaluate((el, classes) => {
      const classList = el.classList;
      return !classList.contains(classes.hidden)
        && !classList.contains(classes.leave)
        && !classList.contains(classes.leaveActive);
    }, {
      hidden: HIDDEN_CLASS,
      leave: LEAVE_CLASS,
      leaveActive: LEAVE_ACTIVE_CLASS
    }).catch(() => false);
    if (active) return dropdown;
  }
  return null;
}

function buildDateCellSelector(dateText) {
  return `td[title="${escapeCssAttr(dateText)}"]:not(.he-trip-kit-ui-picker-cell-disabled)`;
}

async function clickDateCell(page, cell) {
  await cell.scrollIntoViewIfNeeded().catch(() => {});
  const inner = cell.locator(DATE_CELL_INNER).first();
  const target = await inner.isVisible().catch(() => false) ? inner : cell;
  if (!(await target.isEnabled().catch(() => true))) {
    throwTripError("DATE_RANGE_NOT_MATCHED", "select_date_range", "Trip date cell is not enabled.");
  }
  await page.waitForTimeout(80);
  await target.click();
}

async function waitPickerClosedOrStable(page) {
  const started = Date.now();
  while (Date.now() - started < 1500) {
    if (!(await getActiveDatePicker(page))) return;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(200);
}

async function buildDateDiagnostics(page, targetDate) {
  const activeDropdown = await getActiveDatePicker(page);
  return {
    targetDate,
    activeDropdownCount: await countActiveDatePickers(page),
    visibleDropdownTexts: await collectVisibleDropdownTexts(page),
    currentMonthYearText: activeDropdown ? await activeDropdown.locator(MONTH_YEAR_LABEL).allInnerTexts().catch(() => []) : [],
    candidateDateTitles: activeDropdown ? await collectCandidateDateTitles(activeDropdown) : [],
    selectorUsed: targetDate ? buildDateCellSelector(targetDate) : `active ${DROPDOWN}`
  };
}

async function countActiveDatePickers(page) {
  const dropdowns = page.locator(DROPDOWN);
  const count = Math.min(await dropdowns.count().catch(() => 0), 8);
  let activeCount = 0;
  for (let index = 0; index < count; index += 1) {
    const dropdown = dropdowns.nth(index);
    if (!(await dropdown.isVisible().catch(() => false))) continue;
    const active = await dropdown.evaluate((el, classes) => {
      const classList = el.classList;
      return !classList.contains(classes.hidden)
        && !classList.contains(classes.leave)
        && !classList.contains(classes.leaveActive);
    }, {
      hidden: HIDDEN_CLASS,
      leave: LEAVE_CLASS,
      leaveActive: LEAVE_ACTIVE_CLASS
    }).catch(() => false);
    if (active) activeCount += 1;
  }
  return activeCount;
}

async function collectVisibleDropdownTexts(page) {
  const dropdowns = page.locator(DROPDOWN);
  const count = Math.min(await dropdowns.count().catch(() => 0), 8);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const dropdown = dropdowns.nth(index);
    if (!(await dropdown.isVisible().catch(() => false))) continue;
    const text = String(await dropdown.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (text) out.push(text.slice(0, 500));
  }
  return out;
}

async function collectCandidateDateTitles(dropdown) {
  return dropdown.locator("td[title]").evaluateAll((cells) => cells
    .map((cell) => cell.getAttribute("title") || "")
    .filter(Boolean)
    .slice(0, 80)).catch(() => []);
}

function escapeCssAttr(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

module.exports = {
  selectDateRange
};
