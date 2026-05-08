"use strict";

const {
  SELECTORS,
  SUBMIT_SUCCESS,
  SUBMIT_SUCCESS_TEXT,
  ERROR_KEYWORDS
} = require("./selectors");
const { normalizeText } = require("./mapper");

async function waitSubmitSuccess(page, timeoutMs) {
  const started = Date.now();
  await waitSubmitSettled(page, 2000);

  while (Date.now() - started < timeoutMs) {
    const snapshot = await readSubmitFeedbackSnapshot(page, started);
    if (snapshot.success) return snapshot;
    await page.waitForTimeout(300);
  }

  await waitSubmitSettled(page, 3000);
  let snapshot = await readSubmitFeedbackSnapshot(page, started);
  if (!snapshot.success && snapshot.pageReady && !snapshot.hasError) {
    await page.waitForTimeout(2000);
    snapshot = await readSubmitFeedbackSnapshot(page, started);
  }
  return snapshot;
}

async function confirmSuccessDialog(page, timeoutMs = 1500) {
  const dialog = page.locator(SELECTORS.successDialog).first();
  if (!(await dialog.isVisible().catch(() => false))) {
    return { confirmed: false, closed: true, reason: "dialog_not_visible" };
  }

  const button = dialog.locator("button").filter({ hasText: /\u786e\s*\u5b9a/ }).first();
  if (!(await button.count()) || !(await button.isVisible().catch(() => false))) {
    return { confirmed: false, closed: false, reason: "button_not_found" };
  }

  await button.click();
  const closed = await waitUntilHidden(page, dialog, timeoutMs);
  return { confirmed: true, closed, reason: closed ? "" : "dialog_not_closed" };
}

async function waitPageReadyAfterSubmit(page, timeoutMs = 1800) {
  const started = Date.now();
  let lastSnapshot = null;
  while (Date.now() - started < timeoutMs) {
    lastSnapshot = await readPageReadySnapshot(page);
    if (lastSnapshot.ready) return { ready: true, reason: "", snapshot: lastSnapshot };
    await page.waitForTimeout(300);
  }
  return {
    ready: false,
    reason: explainPageReadySnapshot(lastSnapshot),
    snapshot: lastSnapshot || {}
  };
}

async function readSubmitFeedbackSnapshot(page, started) {
  const visibleModalTexts = await collectVisibleTexts(page, SELECTORS.visibleModal, 8);
  const visibleToastTexts = await collectVisibleTexts(page, SELECTORS.toastFeedback, 8);
  const pageSuccessTextCandidates = await collectPageSuccessTextCandidates(page);
  const pageErrorTextCandidates = await collectPageErrorTextCandidates(page);
  const allText = [...visibleModalTexts, ...visibleToastTexts, ...pageSuccessTextCandidates].join(" | ");
  const hasSuccess = isSuccessText(allText);
  const hasModalSuccess = visibleModalTexts.some(isSuccessText);
  const hasToastSuccess = visibleToastTexts.some(isSuccessText);
  const hasError = [...visibleModalTexts, ...visibleToastTexts, ...pageErrorTextCandidates].some(isErrorText);

  return {
    success: hasSuccess,
    hasDialog: hasModalSuccess,
    hasError,
    pageReady: await isPageReady(page),
    source: hasModalSuccess ? "modal" : hasToastSuccess ? "toast" : hasSuccess ? "text" : "none",
    text: normalizeText(allText).slice(0, 500),
    observedMs: Date.now() - started,
    diagnostics: {
      visibleModalTexts,
      visibleToastTexts,
      pageSuccessTextCandidates,
      pageErrorTextCandidates,
      submitFeedbackWaitMs: Date.now() - started
    }
  };
}

async function collectVisibleTexts(page, selector, limit) {
  const loc = page.locator(selector);
  const count = Math.min(await loc.count().catch(() => 0), limit);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const item = loc.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = normalizeText(await item.innerText().catch(() => ""));
    if (text) out.push(text);
  }
  return out;
}

async function collectPageSuccessTextCandidates(page) {
  return collectPageTextCandidates(page, [SUBMIT_SUCCESS, SUBMIT_SUCCESS_TEXT, "\u6210\u529f", "\u5df2\u5b8c\u6210"]);
}

async function collectPageErrorTextCandidates(page) {
  return collectPageTextCandidates(page, ERROR_KEYWORDS);
}

async function collectPageTextCandidates(page, keywords) {
  return page.evaluate((words) => {
    const text = String(document.body && document.body.innerText || "");
    return text.split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line && words.some((keyword) => line.includes(keyword)))
      .slice(0, 20);
  }, keywords).catch(() => []);
}

async function waitSubmitSettled(page, timeoutMs) {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const loading = page.locator(SELECTORS.loading).first();
    if (!(await loading.isVisible().catch(() => false))) return;
    await page.waitForTimeout(200);
  }
}

async function waitUntilHidden(page, locator, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await locator.isVisible().catch(() => false))) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

function isSuccessText(text) {
  const value = String(text || "");
  return value.includes(SUBMIT_SUCCESS)
    || value.includes(SUBMIT_SUCCESS_TEXT)
    || (value.includes("\u6210\u529f") && (value.includes("\u63d0\u4ea4") || value.includes("\u5df2\u5b8c\u6210")));
}

function isErrorText(text) {
  const value = String(text || "");
  return ERROR_KEYWORDS.some((keyword) => value.includes(keyword)) && !isSuccessText(value);
}

async function isPageReady(page) {
  return (await readPageReadySnapshot(page)).ready;
}

async function readPageReadySnapshot(page) {
  const dialogVisible = await page.locator(SELECTORS.successDialog).first().isVisible().catch(() => false);
  const roomReady = await page.locator(SELECTORS.roomTree).first().isVisible().catch(() => false);
  const dateReady = await page.locator(SELECTORS.datePickers).first().isVisible().catch(() => false);
  const priceReady = await page.locator(SELECTORS.priceRowTitle).first().isVisible().catch(() => false);
  const submitReady = await page.locator(SELECTORS.submitButton).first().isVisible().catch(() => false);
  return {
    ready: !dialogVisible && roomReady && dateReady && priceReady && submitReady,
    successDialogVisible: dialogVisible,
    roomReady,
    dateReady,
    priceReady,
    submitReady
  };
}

function explainPageReadySnapshot(snapshot) {
  const value = snapshot || {};
  const missing = [];
  if (value.successDialogVisible) missing.push("success_dialog_still_visible");
  if (!value.roomReady) missing.push("room_tree_not_ready");
  if (!value.dateReady) missing.push("date_picker_not_ready");
  if (!value.priceReady) missing.push("price_table_not_ready");
  if (!value.submitReady) missing.push("submit_button_not_ready");
  return missing.length ? missing.join(",") : "page_not_ready_after_submit";
}

module.exports = {
  waitSubmitSuccess,
  confirmSuccessDialog,
  waitPageReadyAfterSubmit
};
