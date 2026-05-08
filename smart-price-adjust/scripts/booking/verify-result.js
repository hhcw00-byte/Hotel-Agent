"use strict";

const { selectors } = require("./selectors");
const { safeText, throwBookingError } = require("./mapper");

async function waitSaveSuccess(page, panel, saveState = {}) {
  const tracker = saveState.tracker;
  const timeoutMs = Math.min(Number(saveState.timeoutMs || 12000), 12000);
  const deadline = Date.now() + timeoutMs;

  try {
    if (saveState.alreadySaved && saveState.successStatusText) {
      return buildSuccess("status", saveState.successStatusText, false, "");
    }

    while (Date.now() < deadline) {
      const feedback = await detectSuccessFeedback(page, tracker);
      if (feedback.success) {
        const recovery = await waitPageRecovery(page, panel, 1500);
        return buildSuccess(feedback.source, feedback.text, !recovery.ready, recovery.reason);
      }
      await waitLoadingGone(page, 500);
      await page.waitForTimeout(250);
    }

    throwBookingError("SUBMIT_RESULT_UNKNOWN", "post_submit_verify", "Booking save success feedback was not found.", {
      submitButtonText: saveState.submitButtonText || "",
      submitFeedbackWaitMs: timeoutMs,
      businessResponseMatched: Boolean(tracker && tracker.responses && tracker.responses.some((item) => item.success && item.ok)),
      visibleToastTexts: await collectVisibleTexts(page, selectors.successText, 20),
      responseSamples: tracker && Array.isArray(tracker.responses) ? tracker.responses.slice(-5) : []
    });
  } finally {
    if (tracker && typeof tracker.stop === "function") tracker.stop();
  }
}

function buildSuccess(source, text, pageRecoveryWarning, pageRecoveryReason) {
  return {
    submitted: true,
    success: true,
    submitResultType: "save_success",
    submitFeedbackSource: source,
    submitFeedbackText: text || "",
    pageRecoveryWarning: Boolean(pageRecoveryWarning),
    diagnostics: {
      businessResponseMatched: source === "response",
      pageRecoveryWarning: Boolean(pageRecoveryWarning),
      pageRecoveryReason: pageRecoveryReason || ""
    }
  };
}

async function detectSuccessFeedback(page, tracker) {
  const response = tracker && Array.isArray(tracker.responses)
    ? tracker.responses.find((item) => item && item.success && item.ok)
    : null;
  if (response) {
    return {
      success: true,
      source: "response",
      text: response.sample || response.url
    };
  }

  const texts = await collectVisibleTexts(page, selectors.successText, 12);
  const successText = texts.find(isSuccessText);
  if (successText) {
    return {
      success: true,
      source: "text",
      text: successText
    };
  }
  return { success: false, source: "", text: "" };
}

async function waitPageRecovery(page, panel, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loading = await hasVisibleLoading(page);
    const panelVisible = await panel.isVisible({ timeout: 500 }).catch(() => false);
    if (!loading || !panelVisible) return { ready: true, reason: "" };
    await page.waitForTimeout(200);
  }
  return { ready: false, reason: "loading_or_panel_state_not_settled_after_save_success" };
}

async function waitLoadingGone(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await hasVisibleLoading(page)) return;
    await page.waitForTimeout(100);
  }
}

async function hasVisibleLoading(page) {
  for (const selector of selectors.loading) {
    if (await page.locator(selector).first().isVisible({ timeout: 300 }).catch(() => false)) return true;
  }
  return false;
}

async function collectVisibleTexts(page, selectorList, limit) {
  const out = [];
  for (const selector of selectorList) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const locator = locators.nth(index);
      const visible = await locator.isVisible({ timeout: 300 }).catch(() => false);
      if (!visible) continue;
      const text = String(await safeText(locator)).replace(/\s+/g, " ").trim();
      if (text && !out.includes(text)) out.push(text.slice(0, 300));
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function isSuccessText(text) {
  return /Submitted|Success|saved|changes saved|Your changes were saved successfully|Your changes were successfully saved|saved successfully|successfully saved|\u5df2\u6210\u529f\u4fdd\u5b58\u4fee\u6539|\u4fdd\u5b58\u6210\u529f|\u5df2\u4fdd\u5b58/i.test(String(text || ""));
}

module.exports = {
  waitSaveSuccess
};
