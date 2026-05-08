"use strict";

const assert = require("assert");
const { saveChanges } = require("./save");

async function main() {
  await testSaveEnabledClicksAndSucceeds();
  await testDisabledAlreadyApplied();
  await testDisabledNotAppliedFails();
  console.log("booking save state smoke passed");
}

async function testSaveEnabledClicksAndSucceeds() {
  const panel = new FakePanel({ startDate: "2026-05-25", endDate: "2026-05-25", price: "391", saveDisabled: false });
  const result = await saveChanges(panel.page, panel, saveOptions(panel));
  assert.strictEqual(result.submitted, true);
  assert.strictEqual(result.submitClicked, true);
  assert.strictEqual(panel.saveClicks, 1);
  assert.strictEqual(result.submitFeedbackSource, "text");
}

async function testDisabledAlreadyApplied() {
  const panel = new FakePanel({ startDate: "2026-05-25", endDate: "2026-05-25", price: "391", saveDisabled: true });
  const result = await saveChanges(panel.page, panel, saveOptions(panel));
  assert.strictEqual(result.alreadyApplied, true);
  assert.strictEqual(result.noChangeNeeded, true);
  assert.strictEqual(result.submitted, false);
  assert.strictEqual(panel.saveClicks, 0);
}

async function testDisabledNotAppliedFails() {
  const panel = new FakePanel({ startDate: "", endDate: "", price: "390", saveDisabled: true });
  const error = await captureError(() => saveChanges(panel.page, panel, saveOptions(panel)));
  assert.strictEqual(error.code, "SUBMIT_BUTTON_DISABLED");
  assert.strictEqual(error.diagnostics.saveButtonDisabled, true);
  assert.strictEqual(error.diagnostics.priceEchoMatched, false);
  assert.deepStrictEqual(error.diagnostics.actualDateReadback, { startDate: "", endDate: "" });
}

function saveOptions() {
  return {
    segmentIndex: 1,
    requestedRoomName: "\u5355\u4eba\u95f4",
    matchedRoomName: "\u5355\u4eba\u95f4",
    selectedRoomBlockTestId: "room-1636074002",
    requestedRatePlanName: "",
    selectedRatePlanName: "Standard Rate",
    expectedStartDate: "2026-05-25",
    expectedEndDate: "2026-05-25",
    expectedPrice: "391",
    saveButtonTimeoutMs: 1,
    timeoutMs: 100
  };
}

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

class FakePanel {
  constructor(options) {
    this.startDate = options.startDate || "";
    this.endDate = options.endDate || "";
    this.price = options.price || "";
    this.saveDisabled = Boolean(options.saveDisabled);
    this.saveClicks = 0;
    this.panelOpen = true;
    this.page = new FakePage(this);
  }

  locator(selector) {
    const text = String(selector || "");
    if (text.includes("date-from")) return new FakeLocator(this, [{ type: "start" }], "input");
    if (text.includes("date-until")) return new FakeLocator(this, [{ type: "end" }], "input");
    if (text === "input" || text.includes("price-input") || text.includes("input[")) return new FakeLocator(this, [{ type: "price" }], "input");
    if (text.includes("Save") || text.includes("submit") || text.includes("\u4fdd\u5b58")) return new FakeLocator(this, [{ type: "save" }], "button");
    if (text.includes("[role=\"dialog\"]") || text === "aside" || text === "section") return new FakeLocator(this, this.panelOpen ? [{ type: "panel" }] : [], "panel");
    return new FakeLocator(this, [], "generic");
  }

  async isVisible() {
    return this.panelOpen;
  }
}

class FakePage {
  constructor(panel) {
    this.panel = panel;
    this.handlers = {};
    this.successText = "";
  }

  locator(selector) {
    const text = String(selector || "");
    if (text === "body") return new FakeLocator(this.panel, [{ type: "body" }], "body");
    if (text.includes("[role=\"dialog\"]") || text === "aside" || text === "section") return new FakeLocator(this.panel, this.panel.panelOpen ? [{ type: "panel" }] : [], "panel");
    if (text.includes("status") || text.includes("alert") || text.includes("saved") || text.includes("Success")) {
      return new FakeLocator(this.panel, this.successText ? [{ type: "success", text: this.successText }] : [], "success");
    }
    return new FakeLocator(this.panel, [], "generic");
  }

  async waitForTimeout() {}

  on(event, handler) {
    this.handlers[event] = handler;
  }

  off(event) {
    delete this.handlers[event];
  }

  url() {
    return "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html";
  }
}

class FakeLocator {
  constructor(panel, items, kind) {
    this.panel = panel;
    this.items = items || [];
    this.kind = kind || "generic";
  }

  first() {
    return this.nth(0);
  }

  nth(index) {
    return new FakeLocator(this.panel, this.items[index] ? [this.items[index]] : [], this.kind);
  }

  locator(selector) {
    if (String(selector).includes("ancestor::form")) return new FakeLocator(this.panel, [{ type: "form" }], "form");
    if (this.kind === "form" && String(selector).includes("Save")) return new FakeLocator(this.panel, [{ type: "save" }], "button");
    if (this.kind === "panel" && String(selector).includes("price-input")) return new FakeLocator(this.panel, [{ type: "price" }], "input");
    return this.panel.locator(selector);
  }

  async count() {
    return this.items.length;
  }

  async isVisible() {
    return this.items.length > 0;
  }

  async textContent() {
    const item = this.items[0];
    if (!item) return "";
    if (item.type === "save") return "Save changes";
    if (item.type === "success") return item.text;
    if (item.type === "body") return "Booking bulk edit body";
    return "";
  }

  async inputValue() {
    const item = this.items[0];
    if (!item) return "";
    if (item.type === "start") return this.panel.startDate;
    if (item.type === "end") return this.panel.endDate;
    if (item.type === "price") return this.panel.price;
    return "";
  }

  async evaluate(fn, arg) {
    const item = this.items[0];
    if (item && item.type === "save") {
      return fn({
        disabled: this.panel.saveDisabled,
        className: this.panel.saveDisabled ? "disabled" : "",
        getAttribute: (name) => {
          if (name === "disabled" && this.panel.saveDisabled) return "";
          if (name === "aria-disabled" && this.panel.saveDisabled) return "true";
          return null;
        }
      }, arg);
    }
    return fn({ className: "" }, arg);
  }

  async scrollIntoViewIfNeeded() {}

  async click() {
    const item = this.items[0];
    if (!item) return;
    if (item.type === "save") {
      this.panel.saveClicks += 1;
      this.panel.page.successText = "Your changes were saved successfully";
    }
  }

  async blur() {}
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
