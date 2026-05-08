"use strict";

const { SELECTORS } = require("./selectors");
const { throwTripError } = require("./mapper");
const {
  waitSubmitSuccess,
  confirmSuccessDialog,
  waitPageReadyAfterSubmit
} = require("./verify-result");

async function submitPriceChanges(page, options = {}) {
  const report = typeof options.progress === "function" ? options.progress : () => {};
  const button = page.locator(SELECTORS.submitButton).first();
  if (!(await button.count()) || !(await button.isVisible().catch(() => false))) {
    throwTripError("SUBMIT_BUTTON_NOT_FOUND", "submit", "Trip save/submit button not found.");
  }
  if (!(await waitSaveButtonEnabled(page, button, 5000))) {
    throwTripError(
      "SUBMIT_DISABLED",
      "submit",
      "Trip save/submit button is disabled.",
      await buildSaveDisabledDiagnostics(page, options.filledPrices || [])
    );
  }

  await button.click();
  report("\u7b49\u5f85\u6210\u529f\u53cd\u9988");
  const success = await waitSubmitSuccess(page, normalizeSubmitFeedbackTimeout(options.timeoutMs));
  if (!success.success) {
    throwTripError(
      "SUBMIT_RESULT_UNKNOWN",
      "post_submit_verify",
      "Trip submit success feedback not found.",
      success.diagnostics || {}
    );
  }

  let confirm = { confirmed: false, closed: true };
  if (success.hasDialog) {
    confirm = await confirmSuccessDialog(page, 1500);
  }

  report("\u9875\u9762\u6062\u590d");
  const recovery = await waitPageReadyAfterSubmit(page, 1800);
  const pageRecoveryWarning = !recovery.ready || !confirm.closed || (success.hasDialog && !confirm.confirmed);
  const pageRecoveryReason = buildPageRecoveryReason(success, confirm, recovery);

  return {
    submitSuccessDetected: true,
    submitFeedbackSource: success.source,
    submitFeedbackConfidence: "high",
    submitFeedbackText: success.text,
    submitResultType: "submit_success",
    submitFeedbackObservedMs: success.observedMs,
    successModalConfirmed: Boolean(confirm.confirmed),
    successModalClosed: Boolean(confirm.closed),
    pageReadyAfterSubmit: Boolean(recovery.ready),
    pageRecoveryWarning,
    pageRecoveryReason,
    diagnostics: {
      ...(success.diagnostics || {}),
      pageRecoveryWarning,
      pageRecoveryReason,
      successDialogConfirmReason: confirm.reason || "",
      pageRecoverySnapshot: recovery.snapshot || {}
    }
  };
}

function buildPageRecoveryReason(success, confirm, recovery) {
  const reasons = [];
  if (success.hasDialog && !confirm.confirmed) reasons.push(confirm.reason || "success_dialog_confirm_not_clicked");
  if (!confirm.closed) reasons.push(confirm.reason || "success_dialog_not_closed");
  if (!recovery.ready) reasons.push(recovery.reason || "page_not_ready_after_submit");
  return reasons.join("; ");
}

function normalizeSubmitFeedbackTimeout(value) {
  const number = Number(value || 10000);
  if (!Number.isFinite(number) || number <= 0) return 10000;
  return Math.min(12000, Math.max(8000, Math.floor(number)));
}

async function waitSaveButtonEnabled(page, button, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await button.isEnabled().catch(() => false)) return true;
    await triggerChange(page);
    await page.waitForTimeout(300);
  }
  return button.isEnabled().catch(() => false);
}

async function triggerChange(page) {
  await page.keyboard.press("Tab").catch(() => {});
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
    document.dispatchEvent(new Event("change", { bubbles: true }));
  }).catch(() => {});
}

async function buildSaveDisabledDiagnostics(page, filledPrices) {
  const button = page.locator(SELECTORS.submitButton).first();
  return {
    saveButtonDisabled: true,
    filledPrices: (Array.isArray(filledPrices) ? filledPrices : []).map((item) => ({
      roomName: item.roomName,
      price: item.price,
      inputPrice: item.inputPrice
    })),
    priceEchoMatched: (Array.isArray(filledPrices) ? filledPrices : []).every((item) => item.priceEchoMatched !== false),
    visibleValidationTexts: await collectVisibleValidationTexts(page),
    currentSaveButtonText: await button.innerText().catch(() => "")
  };
}

async function collectVisibleValidationTexts(page) {
  const loc = page.locator(SELECTORS.validationFeedback);
  const count = Math.min(await loc.count().catch(() => 0), 12);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const item = loc.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = String(await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

module.exports = {
  submitPriceChanges
};
