"use strict";

const { SELECTORS } = require("./selectors");
const { compactText } = require("./mapper");

function attachNativeDialogGuard(page, session) {
  if (!page || session.nativeDialogHandler) return;
  session.nativeDialogMessages = Array.isArray(session.nativeDialogMessages) ? session.nativeDialogMessages : [];
  session.nativeDialogHandled = Boolean(session.nativeDialogHandled);
  session.nativeDialogHandler = async (dialog) => {
    try {
      session.nativeDialogHandled = true;
      session.nativeDialogMessages.push(String(dialog && dialog.message ? dialog.message() : ""));
      await dialog.dismiss().catch(() => {});
    } catch (_) {}
  };
  page.on("dialog", session.nativeDialogHandler);
}

function detachNativeDialogGuard(session) {
  if (!session || !session.page || !session.nativeDialogHandler) return;
  try {
    session.page.off("dialog", session.nativeDialogHandler);
  } catch (_) {}
  session.nativeDialogHandler = null;
}

async function dismissBlockingModals(page) {
  const buttons = page.locator(SELECTORS.blockingModalDismissButton);
  const total = Math.min(await buttons.count().catch(() => 0), 10);
  let dismissed = false;
  for (let index = 0; index < total; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const text = compactText(await button.innerText().catch(() => ""));
    if (!isSafeDismissText(text)) continue;
    await button.click({ force: true }).then(() => {
      dismissed = true;
    }).catch(() => {});
    if (dismissed) break;
  }

  const close = page.locator(SELECTORS.blockingModalClose).first();
  if (!dismissed && await close.isVisible().catch(() => false)) {
    await close.click({ force: true }).then(() => {
      dismissed = true;
    }).catch(() => {});
  }

  if (dismissed) await page.waitForTimeout(200).catch(() => {});
  return dismissed;
}

function isSafeDismissText(text) {
  const value = compactText(text);
  return value === "\u53d6\u6d88"
    || value === "\u5173\u95ed"
    || value === "\u7a0d\u540e"
    || value === "\u7a0d\u540e\u518d\u8bf4";
}

module.exports = {
  attachNativeDialogGuard,
  detachNativeDialogGuard,
  dismissBlockingModals
};
