"use strict";

const SELECTORS = Object.freeze({
  roomArea: ".product-area",
  roomBlock: ".room-goods-item",
  roomBaseName: ".room-goods-item-room-name",
  roomRow: ".room-goods-item-goods-item",
  roomCheckbox: "input[type='checkbox']",
  roomProductCheckbox: ".room-goods-item-goods-item input[type='checkbox']",
  roomProductTitle: "span[title]",
  roomName: ".goods-name, .room-name, [class*='name']",
  checkboxWrapper: "label.mtd-checkbox, .mtd-checkbox",
  selectedSummary: ".product-area-header-left-sum",
  datePanel: ".mtd-singleRangePicker-pop",
  dateRangeInput: ".mtd-single-range-picker-input input.mtd-input-inner-input",
  dateRangeControl: ".mtd-single-range-picker-input, .mtd-single-range-picker",
  dateCalendar: ".mtd-date-calendar",
  dateCell: ".mtd-date-panel-data-wrapper .mtd-date-panel-data",
  dateMonthNext: ".mtd-date-calendar-month-switcher.right-switcher, [class*='month-switcher'][class*='right']",
  dateMonthPrev: ".mtd-date-calendar-month-switcher.left-switcher, [class*='month-switcher'][class*='left']",
  priceTable: ".basic-batch-calc-price--set-price",
  priceRow: ".basic-batch-calc-price--content",
  priceRowName: ".goods-name, .room-name, [class*='name']",
  priceRowInput: [
    ".price-adjust-wrapper input.mtd-input-inner-input[placeholder='\u8bf7\u8f93\u5165']",
    "input.mtd-input-inner-input[placeholder='\u8bf7\u8f93\u5165']",
    "input[placeholder='\u8bf7\u8f93\u5165']"
  ].join(", "),
  submitButton: [
    ".page-control-area button",
    "button.mtd-button.mtd-button-primary.mtd-button-rect",
    "button"
  ].join(", "),
  submitConfirmDialog: ".mtd-confirm, .mtd-modal, .mtd-modal-body",
  submitConfirmButton: [
    "button:has-text('\u786e\u8ba4\u5e76\u63d0\u4ea4')",
    ".mtd-confirm button.mtd-button-primary",
    ".mtd-modal-body button.mtd-button-primary",
    "button:has-text('\u786e\u5b9a')",
    "button:has-text('\u786e\u8ba4')"
  ].join(", "),
  visibleModal: ".mtd-confirm, .mtd-modal, .mtd-modal-body",
  blockingModalDismissButton: [
    "button:has-text('\u53d6\u6d88')",
    "button:has-text('\u5173\u95ed')",
    "button:has-text('\u7a0d\u540e')",
    "button:has-text('\u7a0d\u540e\u518d\u8bf4')"
  ].join(", "),
  blockingModalClose: ".mtd-modal-close",
  toastFeedback: ".mtd-message, .mtd-notification, .mtd-toast",
  loading: ".mtd-loading, [class*='loading'], [class*='spin']"
});

module.exports = {
  SELECTORS,
  SUBMIT_BUTTON_TEXTS: Object.freeze(["\u63d0\u4ea4\u5e76\u7ee7\u7eed\u4fee\u6539", "\u63d0\u4ea4", "\u4fdd\u5b58"]),
  SUBMIT_CONFIRM_TEXTS: Object.freeze(["\u786e\u8ba4\u63d0\u4ea4\u5417", "\u786e\u8ba4\u5e76\u63d0\u4ea4", "\u8bf7\u786e\u8ba4\u6539\u4ef7\u7ed3\u679c"]),
  SUBMIT_SUCCESS_TEXTS: Object.freeze(["\u6210\u529f"])
};
