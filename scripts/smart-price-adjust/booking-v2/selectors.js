"use strict";

const SELECTORS = Object.freeze({
  room: ".av-cal-list-room[data-test-id^=\"room-\"]",
  roomTitle: ".av-cal-list-room__title",
  roomBulkEditButton: ".av-cal-list-room__name-row [data-test-id=\"general-modal-cta\"]",
  dateFrom: ["[data-test-id=\"date-from\"]", "#date-from"],
  dateUntil: ["[data-test-id=\"date-until\"]", "#date-until"],
  priceInput: "#price-input-0",
  accordion: "[data-test-id=\"accordion\"]",
  submitButton: "button[type=\"submit\"]",
  enabledSubmitButton: "button[type=\"submit\"]:not([disabled])",
  status: "[role=\"status\"]",
  closeButton: [
    "button[aria-label=\"Close\"]",
    "button[aria-label*=\"Close\" i]",
    "button[aria-label=\"关闭\"]",
    "button[aria-label*=\"关闭\"]",
    "[data-test-id=\"modal-close\"]",
    "[data-testid=\"modal-close\"]"
  ]
});

const SUCCESS_PHRASES = Object.freeze([
  "已成功保存",
  "成功保存",
  "saved successfully",
  "successfully saved",
  "changes saved",
  "berjaya",
  "disimpan"
]);

module.exports = {
  SELECTORS,
  SUCCESS_PHRASES
};
