"use strict";

const { SELECTORS } = require("./selectors");
const { throwCtripError } = require("./mapper");

async function selectDateRange(page, segment) {
  await selectDate(page, 0, segment.startDate);
  await selectDate(page, 1, segment.endDate);
}

async function selectDate(page, pickerIndex, dateText) {
  const pickers = page.locator(SELECTORS.datePickers);
  if ((await pickers.count()) <= pickerIndex) {
    throwCtripError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Ctrip date picker not found: index=${pickerIndex}`);
  }

  await pickers.nth(pickerIndex).locator(SELECTORS.datePickerInput).first().click();
  await page.waitForSelector(SELECTORS.visibleDateDropdown, { timeout: 5000 });

  for (let index = 0; index < 12; index += 1) {
    const cell = page.locator(`${SELECTORS.visibleDateDropdown} ${SELECTORS.dateCell}[title='${dateText}']`).first();
    if (await cell.isVisible().catch(() => false)) {
      await cell.click();
      await page.waitForTimeout(200);
      return;
    }
    const next = page.locator(`${SELECTORS.visibleDateDropdown} ${SELECTORS.monthNext}`).first();
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(150);
  }

  throwCtripError("DATE_RANGE_NOT_MATCHED", "select_date_range", `Ctrip date not found: ${dateText}`);
}

module.exports = {
  selectDateRange
};
