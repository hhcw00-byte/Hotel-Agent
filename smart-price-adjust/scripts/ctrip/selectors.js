"use strict";

const SUBMIT_SUCCESS = "\u63d0\u4ea4\u6210\u529f";
const SUBMIT_SUCCESS_TEXT = "\u63d0\u4ea4\u7684\u6570\u636e\u5df2\u5168\u90e8\u5b8c\u6210\u5e76\u6210\u529f";
const SAVE_TEXT = "\u4fdd\u5b58";
const ERROR_KEYWORDS = Object.freeze([
  "\u5931\u8d25",
  "\u9519\u8bef",
  "\u5f02\u5e38",
  "\u672a\u6210\u529f",
  "\u4fdd\u5b58\u5931\u8d25",
  "\u63d0\u4ea4\u5931\u8d25",
  "\u98ce\u63a7",
  "\u8bf7\u91cd\u8bd5"
]);

const SELECTORS = Object.freeze({
  productFilter: ".rc-product-select-view__filter",
  allDayRoomFilter: ".rc-product-select-view__filter [he-clicktag='allDayRoom']",
  roomTree: ".rc-product-select-view-tree",
  roomNode: ".rc-product-select-view-tree .rc-product-select-view-basic-room",
  roomName: ".rc-product-select-view-tree__name",
  roomCheckbox: ".he-trip-kit-ui-tree-checkbox",
  datePickers: ".he-trip-kit-ui-picker",
  datePickerInput: "input",
  visibleDateDropdown: ".he-trip-kit-ui-picker-dropdown:not(.he-trip-kit-ui-picker-dropdown-hidden)",
  dateCell: "td[title]",
  monthNext: ".he-trip-kit-ui-picker-header-next-btn",
  monthPrev: ".he-trip-kit-ui-picker-header-prev-btn",
  dateYearMonthLabels: ".he-trip-kit-ui-select-selection-item",
  priceRowTitle: ".index_productTitle__3OfwO",
  priceInput: "input[id^='data_'][id$='_priceChangeData_price']",
  submitButton: `button[he-click='batchPriceSetting-submit']:has-text('${SAVE_TEXT}'), button[he-click='batchPriceSetting-submit']`,
  visibleModal: ".he-trip-kit-ui-modal, .he-trip-kit-ui-dialog, .ant-modal",
  successDialog: `.he-trip-kit-ui-modal:has-text('${SUBMIT_SUCCESS}'), .he-trip-kit-ui-dialog:has-text('${SUBMIT_SUCCESS}'), .ant-modal:has-text('${SUBMIT_SUCCESS}')`,
  successTitle: `text=${SUBMIT_SUCCESS}`,
  successText: `text=${SUBMIT_SUCCESS_TEXT}`,
  toastFeedback: [
    ".he-trip-kit-ui-message-notice-content",
    ".ant-message-notice-content",
    ".he-trip-kit-ui-notification-notice-message",
    ".he-trip-kit-ui-notification-notice-description",
    ".ant-notification-notice-message",
    ".ant-notification-notice-description"
  ].join(", "),
  validationFeedback: [
    ".he-trip-kit-ui-form-item-explain",
    ".ant-form-item-explain",
    ".he-trip-kit-ui-message-notice-content",
    ".ant-message-notice-content",
    ".he-trip-kit-ui-notification-notice-description",
    ".ant-notification-notice-description"
  ].join(", "),
  loading: ".he-trip-kit-ui-spin-spinning, .ant-spin-spinning, [class*='loading'], [class*='Loading']"
});

module.exports = {
  SELECTORS,
  SUBMIT_SUCCESS,
  SUBMIT_SUCCESS_TEXT,
  ERROR_KEYWORDS
};
