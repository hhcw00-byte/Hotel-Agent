"use strict";

const SUBMIT_SUCCESS_TEXTS = Object.freeze([
  "Submitted successfully",
  "Saved successfully",
  "All done",
  "rate changes have been made",
  "Success",
  "\u63d0\u4ea4\u6210\u529f",
  "\u4fdd\u5b58\u6210\u529f",
  "\u8bbe\u7f6e\u6210\u529f",
  "\u5df2\u5b8c\u6210",
  "\u6210\u529f"
]);

const ERROR_KEYWORDS = Object.freeze([
  "Failed",
  "Failure",
  "Error",
  "Unsuccessful",
  "Risk",
  "Please try again",
  "\u5931\u8d25",
  "\u9519\u8bef",
  "\u5f02\u5e38",
  "\u672a\u6210\u529f",
  "\u4fdd\u5b58\u5931\u8d25",
  "\u63d0\u4ea4\u5931\u8d25",
  "\u98ce\u63a7",
  "\u8bf7\u91cd\u8bd5"
]);

const ALL_DAY_ROOM_TEXTS = Object.freeze([
  "All-day room",
  "All Day Room",
  "All day room",
  "All",
  "\u5168\u65e5\u623f",
  "\u5168\u90e8\u663e\u793a"
]);

const SELECTORS = Object.freeze({
  productFilter: ".rc-product-select-view__filter",
  allDayRoomFilter: ".rc-product-select-view__filter [he-clicktag='allDayRoom']",
  roomTree: ".rc-product-select-view-tree, .he-trip-kit-ui-tree, .ant-tree",
  roomNode: [
    ".rc-product-select-view-tree .rc-product-select-view-basic-room",
    ".he-trip-kit-ui-tree .he-trip-kit-ui-tree-treenode",
    ".ant-tree .ant-tree-treenode"
  ].join(", "),
  roomName: ".rc-product-select-view-tree__name, .he-trip-kit-ui-tree-title, .ant-tree-title",
  roomCheckbox: ".he-trip-kit-ui-tree-checkbox, .ant-tree-checkbox, input[type='checkbox']",
  datePickers: ".he-trip-kit-ui-picker, .ant-picker",
  datePickerInput: "input",
  visibleDateDropdown: [
    ".he-trip-kit-ui-picker-dropdown:not(.he-trip-kit-ui-picker-dropdown-hidden)",
    ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)"
  ].join(", "),
  dateCell: "td[title], [data-date], [aria-label]",
  monthNext: ".he-trip-kit-ui-picker-header-next-btn, .ant-picker-header-next-btn",
  monthPrev: ".he-trip-kit-ui-picker-header-prev-btn, .ant-picker-header-prev-btn",
  priceRowTitle: ".index_productTitle__3OfwO, [class*='productTitle']",
  priceInput: "input[id^='data_'][id$='_priceChangeData_price']",
  submitButton: [
    "button[he-click='batchPriceSetting-submit']",
    "button:has-text('Save changes')",
    "button:has-text('Save')",
    "button:has-text('Submit')",
    "button:has-text('\u4fdd\u5b58')",
    "button:has-text('\u63d0\u4ea4')"
  ].join(", "),
  visibleModal: [
    ".he-trip-kit-ui-modal",
    ".he-trip-kit-ui-dialog",
    ".ant-modal",
    "[role='dialog']"
  ].join(", "),
  toastFeedback: [
    ".he-trip-kit-ui-message-notice-content",
    ".ant-message-notice-content",
    ".he-trip-kit-ui-notification-notice-message",
    ".he-trip-kit-ui-notification-notice-description",
    ".ant-notification-notice-message",
    ".ant-notification-notice-description",
    "[role='alert']"
  ].join(", "),
  validationFeedback: [
    ".he-trip-kit-ui-form-item-explain",
    ".ant-form-item-explain",
    ".he-trip-kit-ui-message-notice-content",
    ".ant-message-notice-content",
    ".he-trip-kit-ui-notification-notice-description",
    ".ant-notification-notice-description",
    "[role='alert']"
  ].join(", "),
  loading: ".he-trip-kit-ui-spin-spinning, .ant-spin-spinning, [class*='loading'], [class*='Loading']"
});

module.exports = {
  SELECTORS,
  ALL_DAY_ROOM_TEXTS,
  SUBMIT_SUCCESS_TEXTS,
  ERROR_KEYWORDS
};
