"use strict";

const {
  SELECTORS,
  SUBMIT_BUTTON_TEXTS
} = require("./selectors");
const {
  watchBusinessSubmitResponse,
  waitSubmitSuccess,
  waitSubmitConfirmDialog,
  clickSubmitConfirmButton,
  waitPageReadyAfterSubmit,
  collectVisibleTexts,
  readSubmitButtonText
} = require("./verify-result");
const { compactText } = require("./mapper");

async function submitPriceChanges(page, options = {}) {
  const report = typeof options.progress === "function" ? options.progress : () => {};
  assertTargetPage(page, "before_submit");

  const target = await waitSubmitButtonReady(page, 5000);
  if (!target) {
    throwMeituanError("SUBMIT_BUTTON_NOT_FOUND", "submit", "Meituan submit button not found.", await buildSubmitDiagnostics(page, 0));
  }
  if (!target.enabled) {
    throwMeituanError("SUBMIT_DISABLED", "submit", "Meituan submit button is disabled.", await buildSubmitDiagnostics(page, 0, target.text));
  }

  const watcher = watchBusinessSubmitResponse(page);
  try {
    await target.button.scrollIntoViewIfNeeded().catch(() => {});
    await target.button.click({ force: true });
    const confirmDialog = await waitSubmitConfirmDialog(page, 2500);
    let confirmButtonClicked = false;
    if (confirmDialog.detected) {
      watcher.reset();
      const confirm = await clickSubmitConfirmButton(page, { timeoutMs: 1500 });
      confirmButtonClicked = Boolean(confirm.clicked);
      if (!confirmButtonClicked) {
        throwMeituanError(
          "SUBMIT_CONFIRM_NOT_FOUND",
          "submit",
          "Meituan submit confirm button not found.",
          {
            ...await buildSubmitDiagnostics(page, 0, target.text),
            confirmDialogDetected: true,
            confirmButtonClicked: false
          }
        );
      }
    }

    report("\u7b49\u5f85\u6210\u529f\u53cd\u9988");
    const success = await waitSubmitSuccess(page, watcher, normalizeSubmitFeedbackTimeout(options.timeoutMs));
    if (!success.success) {
      throwMeituanError(
        "SUBMIT_RESULT_UNKNOWN",
        "post_submit_verify",
        "Meituan submit success feedback not found.",
        {
          ...(success.diagnostics || {}),
          businessResponseMatched: Boolean(watcher.state.businessResponseMatched),
          confirmDialogDetected: Boolean(confirmDialog.detected),
          confirmButtonClicked,
          pageRecoveryWarning: false
        }
      );
    }

    report("\u9875\u9762\u6062\u590d");
    const recovery = await waitPageReadyAfterSubmit(page, 1500);
    const pageRecoveryWarning = !recovery.ready;
    const diagnostics = {
      ...(success.diagnostics || {}),
      businessResponseMatched: Boolean(watcher.state.businessResponseMatched),
      confirmDialogDetected: Boolean(confirmDialog.detected),
      confirmButtonClicked,
      submitFeedbackSource: success.source,
      pageRecoveryWarning,
      pageRecoveryReason: recovery.reason || ""
    };

    return {
      ok: true,
      success: true,
      submitted: true,
      submitClicked: true,
      submitButtonText: target.text,
      submitSuccessDetected: true,
      submitFeedbackSource: success.source,
      submitFeedbackText: success.text,
      submitFeedbackObservedMs: success.observedMs,
      businessResponseMatched: Boolean(watcher.state.businessResponseMatched),
      confirmDialogDetected: Boolean(confirmDialog.detected),
      confirmButtonClicked,
      pageRecoveryWarning,
      diagnostics
    };
  } finally {
    watcher.stop();
  }
}

async function waitSubmitButtonReady(page, timeoutMs) {
  const started = Date.now();
  let lastTarget = null;
  while (Date.now() - started < timeoutMs) {
    assertTargetPage(page, "wait_submit_button");
    lastTarget = await resolveSubmitButtonTarget(page);
    if (lastTarget && lastTarget.visible && lastTarget.enabled) return lastTarget;
    await triggerChange(page);
    await page.waitForTimeout(300).catch(() => {});
  }
  return lastTarget;
}

async function resolveSubmitButtonTarget(page) {
  const buttons = page.locator(SELECTORS.submitButton);
  const count = Math.min(await buttons.count().catch(() => 0), 120);
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const text = compactText(await button.innerText().catch(() => ""));
    if (!isSubmitText(text)) continue;
    const visible = await button.isVisible().catch(() => false);
    const enabled = await button.isEnabled().catch(() => false);
    const meta = await button.evaluate((node) => ({
      inPageControl: Boolean(node && node.closest(".page-control-area")),
      primary: String(node && node.className || "").includes("mtd-button-primary")
    })).catch(() => ({ inPageControl: false, primary: false }));
    candidates.push({
      button,
      text,
      visible,
      enabled,
      score: Number(meta.inPageControl) * 100 + Number(meta.primary) * 50 + submitTextScore(text)
    });
  }

  candidates.sort((left, right) => right.score - left.score || Number(right.enabled) - Number(left.enabled));
  return candidates[0] || null;
}

function isSubmitText(text) {
  const value = compactText(text);
  return SUBMIT_BUTTON_TEXTS.some((item) => value === item || value.includes(item));
}

function submitTextScore(text) {
  const value = compactText(text);
  if (value === SUBMIT_BUTTON_TEXTS[0]) return 30;
  if (value === SUBMIT_BUTTON_TEXTS[1]) return 20;
  if (value === SUBMIT_BUTTON_TEXTS[2]) return 10;
  return 1;
}

async function triggerChange(page) {
  await page.keyboard.press("Tab").catch(() => {});
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
    document.dispatchEvent(new Event("change", { bubbles: true }));
  }).catch(() => {});
}

async function buildSubmitDiagnostics(page, submitFeedbackWaitMs, submitButtonText = "") {
  const visibleToastTexts = await collectVisibleTexts(page, SELECTORS.toastFeedback, 8);
  const visibleModalTexts = await collectVisibleTexts(page, SELECTORS.visibleModal, 8);
  return {
    visibleToastTexts,
    visibleModalTexts,
    submitButtonText: submitButtonText || await readSubmitButtonText(page),
    submitFeedbackWaitMs,
    businessResponseMatched: false,
    confirmDialogDetected: false,
    confirmButtonClicked: false,
    pageRecoveryWarning: false
  };
}

function normalizeSubmitFeedbackTimeout(value) {
  const number = Number(value || 10000);
  if (!Number.isFinite(number) || number <= 0) return 10000;
  return Math.min(12000, Math.max(8000, Math.floor(number)));
}

function assertTargetPage(page, stage) {
  const url = String(page && typeof page.url === "function" ? page.url() : "");
  if (!url.toLowerCase().includes("/ebooking/merchant/product/batch-price")) {
    throwMeituanError("TARGET_PAGE_LEFT", "page_guard", `Meituan target page left during submit: ${url}`, {
      stage,
      url
    });
  }
}

function throwMeituanError(code, stage, message, diagnostics = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.stage = stage;
  error.diagnostics = diagnostics;
  throw error;
}

module.exports = {
  submitPriceChanges
};
