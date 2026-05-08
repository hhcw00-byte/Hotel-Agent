"use strict";

const { selectors } = require("./selectors");
const { closeAnyBulkEditPanel, detectBulkEditPanel } = require("./bulk-edit");
const { isVisible, priceMatches, safeText, throwBookingError } = require("./mapper");

async function saveChanges(page, panel, options = {}) {
  const tracker = createSaveTracker(page);
  try {
    const state = await waitForSaveButton(page, panel, options.saveButtonTimeoutMs || 5000);
    if (!state.button) {
      throwBookingError("SUBMIT_BUTTON_NOT_FOUND", "submit", "Booking Save changes button was not found.", await saveDiagnostics(page, panel, state, {
        ...options,
        failedStep: "save_button_not_found"
      }));
    }

    const diagnostics = await saveDiagnostics(page, panel, state, {
      ...options,
      failedStep: state.disabled ? "save_button_disabled" : ""
    });

    if (state.disabled) {
      if (isAlreadyApplied(diagnostics)) {
        tracker.stop();
        return {
          tracker: createNoopTracker(),
          submitted: false,
          submitClicked: false,
          alreadyApplied: true,
          noChangeNeeded: true,
          submitResultType: "already_applied",
          submitFeedbackSource: "readback",
          submitFeedbackText: "",
          diagnostics
        };
      }
      throwBookingError("SUBMIT_BUTTON_DISABLED", "submit", "Booking Save changes button is disabled.", diagnostics);
    }

    await state.button.scrollIntoViewIfNeeded().catch(() => {});
    await state.button.click({ timeout: 3000 });
    const feedback = await waitForSaveFeedback(page, panel, tracker, options.timeoutMs || 12000);
    tracker.stop();
    return {
      tracker: createNoopTracker(),
      submitted: true,
      submitClicked: true,
      submitResultType: "save_success",
      submitButtonText: diagnostics.saveButtonText,
      submitFeedbackSource: feedback.source,
      submitFeedbackText: feedback.text,
      diagnostics: {
        ...diagnostics,
        businessResponseMatched: feedback.source === "response",
        pageRecoveredAfterSave: feedback.source === "panel_recovered"
      }
    };
  } catch (error) {
    tracker.stop();
    throw error;
  }
}

async function afterSaveRecover(page) {
  await closeAnyBulkEditPanel(page).catch(() => {});
  await waitLoadingGone(page, 3000);
  return {
    bulkEditPanelOpen: Boolean(await detectBulkEditPanel(page))
  };
}

async function waitForSaveButton(page, panel, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs || 5000, 10000);
  let lastButton = null;
  let lastDisabled = false;
  while (Date.now() < deadline) {
    const scopes = await resolveSaveScopes(panel);
    for (const scope of scopes) {
      for (const selector of selectors.saveButton || []) {
        const button = scope.locator(selector).first();
        if (!await isVisible(button)) continue;
        lastButton = button;
        lastDisabled = await isDisabled(button);
        if (!lastDisabled) return { button, disabled: false };
      }
    }
    await page.waitForTimeout(150);
  }
  return {
    button: lastButton,
    disabled: Boolean(lastButton && lastDisabled)
  };
}

async function resolveSaveScopes(panel) {
  const scopes = [];
  const priceInput = panel.locator(priceInputSelector()).first();
  if (await isVisible(priceInput)) {
    const form = priceInput.locator("xpath=ancestor::form[1]");
    if (await isVisible(form)) scopes.push(form);
  }
  scopes.push(panel);
  return scopes;
}

async function isDisabled(button) {
  return button.evaluate((node) => Boolean(
    node.disabled
    || node.getAttribute("disabled") !== null
    || node.getAttribute("aria-disabled") === "true"
    || /\bdisabled\b/i.test(String(node.className || ""))
  )).catch(() => false);
}

async function waitForSaveFeedback(page, panel, tracker, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs || 12000, 12000);
  while (Date.now() < deadline) {
    const response = tracker.responses.find((item) => item.ok && item.success);
    if (response) return { source: "response", text: response.sample || response.url };

    const text = (await collectVisibleTexts(page, selectors.successText, 12)).find(isSuccessText);
    if (text) return { source: "text", text };

    if (!await detectBulkEditPanel(page)) return { source: "panel_recovered", text: "" };
    await waitLoadingGone(page, 500);
    await page.waitForTimeout(250);
  }
  throwBookingError("SUBMIT_RESULT_UNKNOWN", "post_submit_verify", "Booking save success feedback was not found.", {
    submitFeedbackWaitMs: Math.min(timeoutMs || 12000, 12000),
    businessResponseMatched: tracker.responses.some((item) => item.ok && item.success),
    visibleToastTexts: await collectVisibleTexts(page, selectors.successText, 20),
    responseSamples: tracker.responses.slice(-5),
    failedStep: "save_success_feedback_not_found"
  });
}

async function saveDiagnostics(page, panel, state = {}, options = {}) {
  const expectedStartDate = stringValue(options.expectedStartDate || options.targetStartDate);
  const expectedEndDate = stringValue(options.expectedEndDate || options.targetEndDate);
  const expectedPrice = stringValue(options.expectedPrice || options.targetPrice);
  const actualDateReadback = {
    startDate: await readInputValue(panel, "#date-from, [data-test-id=\"date-from\"]"),
    endDate: await readInputValue(panel, "#date-until, [data-test-id=\"date-until\"]")
  };
  const actualPriceValue = await readInputValue(panel, priceInputSelector());
  return {
    platformCode: "booking",
    segmentIndex: options.segmentIndex || options.currentSegmentIndex,
    requestedRoomName: stringValue(options.requestedRoomName),
    matchedRoomName: stringValue(options.matchedRoomName),
    selectedRoomBlockTestId: stringValue(options.selectedRoomBlockTestId),
    requestedRatePlanName: stringValue(options.requestedRatePlanName),
    selectedRatePlanName: stringValue(options.selectedRatePlanName),
    expectedStartDate,
    expectedEndDate,
    actualDateReadback,
    expectedPrice,
    actualPriceValue,
    priceEchoMatched: priceMatches(actualPriceValue, expectedPrice),
    saveButtonDisabled: Boolean(state.disabled),
    saveButtonText: state.button ? await safeText(state.button) : "",
    currentUrl: page.url ? page.url() : "",
    bodyTextSample: String(await safeText(page.locator("body").first()).catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500),
    failedStep: options.failedStep || ""
  };
}

function isAlreadyApplied(diagnostics) {
  return dateValueMatches(diagnostics.actualDateReadback && diagnostics.actualDateReadback.startDate, diagnostics.expectedStartDate)
    && dateValueMatches(diagnostics.actualDateReadback && diagnostics.actualDateReadback.endDate, diagnostics.expectedEndDate)
    && Boolean(diagnostics.priceEchoMatched);
}

function dateValueMatches(actual, expected) {
  const actualText = String(actual || "").trim();
  const expectedText = String(expected || "").trim();
  if (!actualText || !expectedText) return false;
  if (actualText === expectedText || actualText.includes(expectedText)) return true;
  const [year, month, day] = expectedText.split("-");
  if (!year || !month || !day) return false;
  const compact = actualText.replace(/\s+/g, "").toLowerCase();
  return compact.includes(`${year}-${Number(month)}-${Number(day)}`)
    || compact.includes(`${Number(day)}/${Number(month)}/${year}`)
    || compact.includes(`${Number(month)}/${Number(day)}/${year}`)
    || compact.includes(`${year}\u5e74${Number(month)}\u6708${Number(day)}\u65e5`);
}

async function waitLoadingGone(page, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs || 3000, 5000);
  while (Date.now() < deadline) {
    if (!await hasVisibleLoading(page)) return;
    await page.waitForTimeout(150);
  }
}

async function hasVisibleLoading(page) {
  for (const selector of selectors.loading || []) {
    if (await page.locator(selector).first().isVisible({ timeout: 300 }).catch(() => false)) return true;
  }
  return false;
}

async function collectVisibleTexts(page, selectorList, limit) {
  const out = [];
  for (const selector of selectorList || []) {
    const locators = page.locator(selector);
    const count = await locators.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const locator = locators.nth(index);
      if (!await isVisible(locator)) continue;
      const text = String(await safeText(locator)).replace(/\s+/g, " ").trim();
      if (text && !out.includes(text)) out.push(text.slice(0, 300));
      if (out.length >= limit) return out;
    }
  }
  return out;
}

async function readInputValue(panel, selector) {
  return panel.locator(selector).first().inputValue().catch(() => "");
}

function priceInputSelector() {
  return "input#price-input-0, input[aria-label=\"Enter price amount\"], input[aria-label=\"\u8f93\u5165\u4ef7\u683c\u91d1\u989d\"], input[name*=\"price\" i], input[id*=\"price\" i]";
}

function createSaveTracker(page) {
  const responses = [];
  const handler = async (response) => {
    try {
      const url = response.url();
      if (!/booking\.com|graphql|calendar|price|availability|save|rate/i.test(url)) return;
      const status = response.status();
      const bodyText = /graphql|save|price|availability|calendar|rate/i.test(url)
        ? await response.text().catch(() => "")
        : "";
      responses.push({
        url,
        status,
        ok: status >= 200 && status < 300,
        success: isSuccessBody(bodyText),
        sample: bodyText ? bodyText.slice(0, 300) : ""
      });
    } catch (_) {}
  };
  page.on("response", handler);
  return {
    responses,
    stop: () => {
      try { page.off("response", handler); } catch (_) {}
    }
  };
}

function createNoopTracker() {
  return {
    responses: [],
    stop: () => {}
  };
}

function isSuccessText(text) {
  return /Your changes were saved successfully|Your changes were successfully saved|saved successfully|successfully saved|\u5df2\u6210\u529f\u4fdd\u5b58\u4fee\u6539|\u4fdd\u5b58\u6210\u529f|\u5df2\u4fdd\u5b58/i.test(String(text || ""));
}

function isSuccessBody(text) {
  const raw = String(text || "");
  if (!raw) return false;
  if (/"success"\s*:\s*true/i.test(raw)) return true;
  if (/"ok"\s*:\s*true/i.test(raw)) return true;
  if (/"status"\s*:\s*"?(success|succeeded|ok|done)"?/i.test(raw)) return true;
  return /submitted|success|saved|changes saved|Your changes were saved successfully|Your changes were successfully saved|saved successfully|successfully saved|\u5df2\u6210\u529f\u4fdd\u5b58\u4fee\u6539|\u4fdd\u5b58\u6210\u529f|\u5df2\u4fdd\u5b58/i.test(raw);
}

function stringValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

module.exports = {
  saveChanges,
  afterSaveRecover,
  saveDiagnostics
};
