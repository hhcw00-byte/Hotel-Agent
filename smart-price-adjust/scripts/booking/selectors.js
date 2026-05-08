"use strict";

const selectors = Object.freeze({
  calendarReady: [
    "text=/Rates\\s*&\\s*Availability/i",
    "text=/Calendar/i",
    "text=/Bulk edit/i",
    "text=/\u623f\u4ef7|\u7a7a\u623f|\u65e5\u5386|\u6279\u91cf\u7f16\u8f91/",
    "text=/房价|空房|日历|批量编辑/"
  ],
  bulkEditButton: [
    "#av-calendar-general-modal-cta",
    "[data-test-id=\"general-modal-cta\"]",
    "button:has-text(\"Bulk edit\")",
    "[role=\"button\"]:has-text(\"Bulk edit\")",
    "a:has-text(\"Bulk edit\")",
    "button:has-text(\"\u6279\u91cf\u7f16\u8f91\")",
    "[role=\"button\"]:has-text(\"\u6279\u91cf\u7f16\u8f91\")",
    "button:has-text(\"批量编辑\")",
    "[role=\"button\"]:has-text(\"批量编辑\")"
  ],
  bulkEditOpenMarkers: [
    "[data-test-id=\"weekdays-selector\"]",
    "button[data-test-id=\"accordion\"]:has-text(\"Prices\")",
    "button[data-test-id=\"accordion\"]:has-text(\"\u4ef7\u683c\")",
    "button:has-text(\"Prices\")",
    "button:has-text(\"\u4ef7\u683c\")",
    "[role=\"button\"]:has-text(\"Prices\")",
    "select#price-select-0",
    "input#price-input-0"
  ],
  bulkEditPanel: [
    "[role=\"dialog\"]",
    "[aria-modal=\"true\"]",
    "aside",
    "section",
    "div[class*=\"drawer\"]",
    "div[class*=\"panel\"]"
  ],
  startDateInput: [
    "#date-from",
    "[data-test-id=\"date-from\"]",
    "input[name*=\"start\" i]",
    "input[id*=\"start\" i]",
    "input[aria-label*=\"Start\" i]",
    "input[placeholder*=\"Start\" i]",
    "input[aria-label*=\"开始\"]",
    "input[placeholder*=\"开始\"]"
  ],
  endDateInput: [
    "#date-until",
    "[data-test-id=\"date-until\"]",
    "input[name*=\"end\" i]",
    "input[id*=\"end\" i]",
    "input[aria-label*=\"End\" i]",
    "input[placeholder*=\"End\" i]",
    "input[aria-label*=\"结束\"]",
    "input[placeholder*=\"结束\"]",
    "input[aria-label*=\"截止\"]",
    "input[placeholder*=\"截止\"]"
  ],
  datePicker: [
    ".bui-calendar",
    "[data-testid*=\"calendar\"]",
    "[class*=\"datepicker\"]",
    "[class*=\"calendar\"]",
    "[role=\"dialog\"]"
  ],
  nextMonthButton: [
    "button[aria-label*=\"Next\" i]",
    "button[aria-label*=\"next\" i]",
    "[role=\"button\"][aria-label*=\"Next\" i]",
    "[data-testid*=\"next\" i]",
    "button:has-text(\"›\")",
    "button:has-text(\">\")"
  ],
  priceSection: [
    "button[data-test-id=\"accordion\"]:has-text(\"Prices\")",
    "button[data-test-id=\"accordion\"]:has-text(\"\u4ef7\u683c\")",
    "button:has-text(\"Prices\")",
    "button:has-text(\"Price\")",
    "[role=\"button\"]:has-text(\"Prices\")",
    "[role=\"button\"]:has-text(\"Price\")",
    "button:has-text(\"价格\")",
    "[role=\"button\"]:has-text(\"价格\")",
    "[aria-expanded]:has-text(\"Prices\")",
    "[aria-expanded]:has-text(\"价格\")"
  ],
  ratePlanControl: [
    "select#price-select-0",
    "select[aria-label=\"Select a rate plan\"]",
    "select[aria-label=\"\u9009\u62e9\u4e00\u4e2a\u623f\u4ef7\u8ba1\u5212\"]",
    "select[name*=\"rate\" i]",
    "select[id*=\"rate\" i]",
    "[role=\"combobox\"][aria-label*=\"Rate\" i]",
    "[aria-haspopup=\"listbox\"]",
    "[role=\"combobox\"]"
  ],
  priceInput: [
    "#price-input-0",
    "input[aria-label=\"Enter price amount\"]",
    "input[aria-label=\"\u8f93\u5165\u4ef7\u683c\u91d1\u989d\"]",
    "input[name*=\"price\" i]",
    "input[id*=\"price\" i]",
    "input[aria-label*=\"Price\" i]",
    "input[placeholder*=\"Price\" i]",
    "input[aria-label*=\"价格\"]",
    "input[placeholder*=\"价格\"]",
    "input[inputmode=\"numeric\"]",
    "input[inputmode=\"decimal\"]",
    "input[type=\"number\"]"
  ],
  saveButton: [
    "button[type=\"submit\"]:has-text(\"Save changes\")",
    "button:has-text(\"Save changes\")",
    "button[type=\"submit\"]:has-text(\"\u4fdd\u5b58\u4fee\u6539\")",
    "button:has-text(\"\u4fdd\u5b58\u4fee\u6539\")",
    "button:has-text(\"\u4fdd\u5b58\")",
    "[role=\"button\"]:has-text(\"Save changes\")",
    "button:has-text(\"Save\")",
    "button:has-text(\"保存修改\")",
    "[role=\"button\"]:has-text(\"保存修改\")",
    "button:has-text(\"保存\")"
  ],
  successText: [
    "[role=\"status\"][aria-live=\"polite\"]",
    "[role=\"status\"]",
    "[role=\"alert\"]",
    "[aria-live=\"polite\"]",
    "[aria-live=\"assertive\"]",
    ".bui-alert",
    ".notification",
    ".toast",
    "text=/Your changes were saved successfully|Your changes were successfully saved|saved successfully|successfully saved/i",
    "text=/\\u5df2\\u6210\\u529f\\u4fdd\\u5b58\\u4fee\\u6539|\\u4fdd\\u5b58\\u6210\\u529f|\\u5df2\\u4fdd\\u5b58/",
    "text=/Submitted|Success|saved|changes saved|保存成功|已保存/i"
  ],
  loading: [
    "[aria-busy=\"true\"]",
    "[role=\"progressbar\"]",
    "[data-testid*=\"spinner\" i]",
    "[data-testid*=\"loading\" i]",
    "[class*=\"spinner\"]",
    "[class*=\"loading\"]"
  ]
});

module.exports = {
  selectors
};
