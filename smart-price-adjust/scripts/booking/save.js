"use strict";

const { selectors } = require("./selectors");
const { isVisible, priceMatches, safeText, throwBookingError } = require("./mapper");

async function saveChanges(page, panel, options = {}) {
  const tracker = createSaveTracker(page);
  try {
    let state = await waitForSaveButton(page, panel, 5000);
    if (!state.button) {
      throwBookingError("SUBMIT_BUTTON_NOT_FOUND", "submit", "Booking Save changes button was not found.", await saveDiagnostics(page, panel, state, options));
    }

    if (state.disabled) {
      await triggerPriceInputChange(panel);
      state = await waitForSaveButton(page, panel, 3000);
    }

    if (state.button && !state.disabled) {
      await state.button.scrollIntoViewIfNeeded().catch(() => {});
      await state.button.click({ timeout: 3000 });
      return {
        tracker,
        submitClicked: true,
        submitButtonText: await safeText(state.button),
        timeoutMs: options.timeoutMs || 12000
      };
    }

    const successStatusText = await findSuccessStatusText(page);
    if (successStatusText) {
      return {
        tracker,
        submitClicked: false,
        alreadySaved: true,
        successStatusText,
        submitButtonText: state.button ? await safeText(state.button) : "",
        timeoutMs: options.timeoutMs || 12000
      };
    }

    throwBookingError("SUBMIT_DISABLED", "submit", "Booking Save changes button is disabled.", await saveDiagnostics(page, panel, state, options));
  } catch (error) {
    tracker.stop();
    throw error;
  }
}

async function waitForSaveButton(page, panel, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastButton = null;
  let lastDisabled = false;
  while (Date.now() < deadline) {
    const scopes = await resolveSaveScopes(panel);
    for (const scope of scopes) {
      for (const selector of selectors.saveButton) {
        const locator = scope.locator(selector).first();
        if (!await isVisible(locator)) continue;
        lastButton = locator;
        lastDisabled = await isDisabled(locator);
        if (!lastDisabled) return { button: locator, disabled: false };
      }
    }
    await triggerPriceInputChange(panel);
    await page.waitForTimeout(250);
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

async function triggerPriceInputChange(panel) {
  const input = panel.locator(priceInputSelector()).first();
  if (!await isVisible(input)) return;
  await input.evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }).catch(() => {});
  await input.blur().catch(() => {});
}

async function saveDiagnostics(page, panel, state = {}, options = {}) {
  const dateFromValue = await readInputValue(panel, "#date-from, [data-test-id=\"date-from\"]");
  const dateUntilValue = await readInputValue(panel, "#date-until, [data-test-id=\"date-until\"]");
  const priceInputValue = await readInputValue(panel, priceInputSelector());
  return {
    dateFromValue,
    dateUntilValue,
    priceInputValue,
    targetPrice: stringValue(options.targetPrice),
    priceEchoMatched: priceMatches(priceInputValue, options.targetPrice),
    saveButtonDisabled: Boolean(state.disabled),
    successStatusTexts: await collectSuccessStatusTexts(page)
  };
}

async function findSuccessStatusText(page) {
  const texts = await collectSuccessStatusTexts(page);
  return texts.find(isSuccessText) || "";
}

async function collectSuccessStatusTexts(page) {
  return collectVisibleTexts(page, selectors.successText, 20);
}

async function collectVisibleTexts(page, selectorList, limit) {
  const out = [];
  for (const selector of selectorList) {
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
      let bodyText = "";
      if (/graphql|save|price|availability|calendar|rate/i.test(url)) {
        bodyText = await response.text().catch(() => "");
      }
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
  saveChanges
};
