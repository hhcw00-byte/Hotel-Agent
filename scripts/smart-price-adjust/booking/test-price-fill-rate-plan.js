"use strict";

const assert = require("assert");
const { fillPrice } = require("./price-fill");

const SINGLE = "\u5355\u4eba\u95f4";

async function main() {
  await testRoomNameIsNotUsedAsRatePlan();
  await testDefaultsToStandardRate();
  await testUsesSingleVisiblePriceInputWhenRatePlanDefaultIsUnknown();
  await testExplicitRatePlanName();
  await testRatePlanRequiredWhenAmbiguous();
  await testRatePlanNotFoundUsesRequestedRatePlanName();
  console.log("booking price-fill rate plan smoke passed");
}

async function testRoomNameIsNotUsedAsRatePlan() {
  const panel = new FakePanel({
    priceInputs: [priceInput("price-input-0")]
  });
  const result = await fillPrice(panel.page(), panel, { roomName: SINGLE, price: "412" }, { segmentIndex: 1 });
  assert.strictEqual(result[0].ok, true);
  assert.strictEqual(result[0].matchedRatePlan, "default");
  assert.strictEqual(panel.priceInputs[0].value, "412");
  assert.deepStrictEqual(panel.selectOptionCalls, []);
}

async function testDefaultsToStandardRate() {
  const panel = new FakePanel({
    ratePlans: [
      ratePlan("", "Select a rate plan", true),
      ratePlan("standard", "Standard Rate", false),
      ratePlan("nonref", "Non-refundable Rate", false)
    ],
    priceInputs: [priceInput("price-input-0")]
  });
  const result = await fillPrice(panel.page(), panel, { roomName: SINGLE, price: "413" }, { segmentIndex: 2 });
  assert.strictEqual(result[0].matchedRatePlan, "Standard Rate");
  assert.deepStrictEqual(panel.selectOptionCalls, ["standard"]);
  assert.strictEqual(panel.priceInputs[0].value, "413");
}

async function testUsesSingleVisiblePriceInputWhenRatePlanDefaultIsUnknown() {
  const panel = new FakePanel({
    ratePlans: [
      ratePlan("nonref", "Non-refundable Rate", false),
      ratePlan("weekly", "Weekly Rate", false)
    ],
    priceInputs: [priceInput("price-input-0")]
  });
  const result = await fillPrice(panel.page(), panel, { roomName: SINGLE, price: "417" }, { segmentIndex: 3 });
  assert.strictEqual(result[0].matchedRatePlan, "default");
  assert.strictEqual(panel.priceInputs[0].value, "417");
}

async function testExplicitRatePlanName() {
  const panel = new FakePanel({
    ratePlans: [
      ratePlan("standard", "Standard Rate", false),
      ratePlan("nonref", "Non-refundable Rate", true)
    ],
    priceInputs: [priceInput("price-input-0")]
  });
  const result = await fillPrice(panel.page(), panel, {
    roomName: SINGLE,
    ratePlanName: "Standard Rate",
    price: "414"
  }, { segmentIndex: 4 });
  assert.strictEqual(result[0].matchedRatePlan, "Standard Rate");
  assert.deepStrictEqual(panel.selectOptionCalls, ["standard"]);
}

async function testRatePlanRequiredWhenAmbiguous() {
  const panel = new FakePanel({
    ratePlans: [
      ratePlan("nonref", "Non-refundable Rate", false),
      ratePlan("weekly", "Weekly Rate", false)
    ]
  });
  const error = await captureError(() => fillPrice(panel.page(), panel, { roomName: SINGLE, price: "415" }, { segmentIndex: 5 }));
  assert.strictEqual(error.code, "RATE_PLAN_REQUIRED");
  assert.strictEqual(error.diagnostics.requestedRoomName, SINGLE);
  assert.strictEqual(error.diagnostics.requestedRatePlanName, "");
  assert.strictEqual(error.diagnostics.ratePlanCandidates.length, 2);
}

async function testRatePlanNotFoundUsesRequestedRatePlanName() {
  const panel = new FakePanel({
    ratePlans: [
      ratePlan("standard", "Standard Rate", true)
    ],
    priceInputs: [priceInput("price-input-0")]
  });
  const error = await captureError(() => fillPrice(panel.page(), panel, {
    roomName: SINGLE,
    ratePlanName: "Weekly Rate",
    price: "416"
  }, { segmentIndex: 6 }));
  assert.strictEqual(error.code, "RATE_PLAN_NOT_FOUND");
  assert.ok(error.message.includes("Weekly Rate"));
  assert.ok(!error.message.includes(SINGLE));
  assert.strictEqual(error.diagnostics.requestedRoomName, SINGLE);
  assert.strictEqual(error.diagnostics.requestedRatePlanName, "Weekly Rate");
}

function ratePlan(value, text, selected) {
  return { value, text, selected: Boolean(selected) };
}

function priceInput(id) {
  return { id, value: "", visible: true };
}

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected function to throw");
}

class FakePage {
  constructor(panel) {
    this.panel = panel;
  }

  async waitForTimeout() {}

  locator() {
    return new FakeLocator(this, [], "generic");
  }
}

class FakePanel {
  constructor(options = {}) {
    this.ratePlans = options.ratePlans || [];
    this.priceInputs = options.priceInputs || [];
    this.selectOptionCalls = [];
    this._page = new FakePage(this);
  }

  page() {
    return this._page;
  }

  locator(selector) {
    const text = String(selector || "");
    if (text.includes("select#price-select-0") || text.includes("select[") || text.includes("[role=\"combobox\"]")) {
      return new FakeLocator(this._page, this.ratePlans.length ? [{ type: "select", panel: this }] : [], "select");
    }
    if (text === "input" || text.includes("price-input-0") || text.includes("input[")) {
      return new FakeLocator(this._page, this.priceInputs, "input");
    }
    if (text.includes("date-from") || text.includes("date-until")) {
      return new FakeLocator(this._page, [], "input");
    }
    if (text.includes("button") || text.includes("accordion") || text.includes("[aria-expanded]")) {
      return new FakeLocator(this._page, [], "button");
    }
    return new FakeLocator(this._page, [], "generic");
  }
}

class FakeLocator {
  constructor(page, items, kind) {
    this._page = page;
    this.items = items || [];
    this.kind = kind || "generic";
  }

  first() {
    return this.nth(0);
  }

  nth(index) {
    return new FakeLocator(this._page, this.items[index] ? [this.items[index]] : [], this.kind);
  }

  filter() {
    return this;
  }

  async count() {
    return this.items.length;
  }

  async isVisible() {
    return this.items.length > 0 && this.items[0].visible !== false;
  }

  async textContent() {
    const item = this.items[0];
    return item && item.text ? item.text : "";
  }

  async inputValue() {
    const item = this.items[0];
    if (!item) return "";
    if (this.kind === "select") {
      const selected = item.panel.ratePlans.find((plan) => plan.selected);
      return selected ? selected.value : "";
    }
    return item.value || "";
  }

  async getAttribute(name) {
    const item = this.items[0];
    return name === "id" && item ? item.id || "" : "";
  }

  async evaluate(fn, arg) {
    const item = this.items[0];
    if (!item) return undefined;
    if (this.kind === "select") {
      return fn({
        tagName: "SELECT",
        options: item.panel.ratePlans.map((plan) => ({
          value: plan.value,
          textContent: plan.text,
          selected: plan.selected
        }))
      }, arg);
    }
    return fn({
      value: item.value || "",
      dispatchEvent: () => {}
    }, arg);
  }

  async evaluateAll(fn) {
    if (this.kind !== "input") return fn([]);
    return fn(this.items.map((item) => ({
      getAttribute: (name) => {
        if (name === "id") return item.id || "";
        if (name === "aria-label") return "Enter price amount";
        return "";
      },
      value: item.value || "",
      offsetWidth: item.visible === false ? 0 : 100,
      offsetHeight: item.visible === false ? 0 : 20,
      getClientRects: () => item.visible === false ? [] : [1]
    })));
  }

  async selectOption(value) {
    const item = this.items[0];
    if (!item || this.kind !== "select") return;
    item.panel.selectOptionCalls.push(value);
    item.panel.ratePlans.forEach((plan) => {
      plan.selected = plan.value === value;
    });
  }

  async scrollIntoViewIfNeeded() {}

  async click() {}

  async focus() {}

  async press(key) {
    const item = this.items[0];
    if (!item || this.kind !== "input") return;
    if (key === "Backspace") item.value = "";
  }

  async type(value) {
    const item = this.items[0];
    if (item && this.kind === "input") item.value = String(value);
  }

  async blur() {}

  page() {
    return this._page;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
