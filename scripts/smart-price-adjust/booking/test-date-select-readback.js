"use strict";

const assert = require("assert");
const { selectDateRange } = require("./date-select");

async function main() {
  await testSingleDayClicksStartAndEnd();
  await testFindsVisibleDayTextInsideTargetMonth();
  await testSingleDaySkipsEndWhenStartClickSetsFullRange();
  await testDateReadbackMismatch();
  console.log("booking date select readback smoke passed");
}

async function testSingleDayClicksStartAndEnd() {
  const panel = new FakePanel();
  const result = await selectDateRange(panel.page, panel, {
    startDate: "2026-05-25",
    endDate: "2026-05-25",
    segmentIndex: 1
  });
  assert.deepStrictEqual(panel.page.dateClicks, ["start:2026-05-25", "end:2026-05-25"]);
  assert.deepStrictEqual(result.actualDateReadback, { startDate: "2026-05-25", endDate: "2026-05-25" });
}

async function testFindsVisibleDayTextInsideTargetMonth() {
  const panel = new FakePanel({ dayTextOnly: true });
  const result = await selectDateRange(panel.page, panel, {
    startDate: "2026-05-25",
    endDate: "2026-05-25",
    segmentIndex: 3
  });
  assert.deepStrictEqual(panel.page.dateClicks, ["start:2026-05-25", "end:2026-05-25"]);
  assert.deepStrictEqual(result.actualDateReadback, { startDate: "2026-05-25", endDate: "2026-05-25" });
}

async function testSingleDaySkipsEndWhenStartClickSetsFullRange() {
  const panel = new FakePanel({ autoFillEndOnStart: true });
  const result = await selectDateRange(panel.page, panel, {
    startDate: "2026-05-25",
    endDate: "2026-05-25",
    segmentIndex: 4
  });
  assert.deepStrictEqual(panel.page.dateClicks, ["start:2026-05-25"]);
  assert.deepStrictEqual(result.actualDateReadback, { startDate: "2026-05-25", endDate: "2026-05-25" });
}

async function testDateReadbackMismatch() {
  const panel = new FakePanel({ suppressEndWrite: true });
  const error = await captureError(() => selectDateRange(panel.page, panel, {
    startDate: "2026-05-25",
    endDate: "2026-05-25",
    segmentIndex: 2
  }));
  assert.strictEqual(error.code, "DATE_READBACK_MISMATCH");
  assert.strictEqual(error.diagnostics.failedStep, "end_date_readback_mismatch");
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
  constructor(options = {}) {
    this.startDate = "";
    this.endDate = "";
    this.suppressEndWrite = Boolean(options.suppressEndWrite);
    this.dayTextOnly = Boolean(options.dayTextOnly);
    this.autoFillEndOnStart = Boolean(options.autoFillEndOnStart);
    this.page = new FakePage(this);
  }

  locator(selector) {
    const text = String(selector || "");
    if (text.includes("date-from")) return new FakeLocator(this, [{ type: "start" }], "input");
    if (text.includes("date-until")) return new FakeLocator(this, [{ type: "end" }], "input");
    if (text === "input") return new FakeLocator(this, [{ type: "start" }, { type: "end" }], "input");
    return new FakeLocator(this, [], "generic");
  }
}

class FakePage {
  constructor(panel) {
    this.panel = panel;
    this.activeDateKind = "";
    this.dateClicks = [];
  }

  locator(selector) {
    const text = String(selector || "");
    if (text === "body") return new FakeLocator(this.panel, [{ type: "body" }], "body");
    if (text.includes("calendar") || text.includes("datepicker") || text.includes("dialog")) return new FakeLocator(this.panel, [{ type: "picker" }], "picker");
    return new FakeLocator(this.panel, [], "generic");
  }

  async waitForTimeout() {}

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
    const item = this.items[0];
    const text = String(selector || "");
    if (this.kind === "picker" && text.includes("2026-05-25") && !this.panel.dayTextOnly) return new FakeLocator(this.panel, [{ type: "date", date: "2026-05-25", text: "25" }], "date-cell");
    if (this.kind === "picker" && text.includes("td, button")) return new FakeLocator(this.panel, [{ type: "date", date: "2026-05-25", text: "25" }], "date-cell");
    if (this.kind === "date-cell" && item) return new FakeLocator(this.panel, [item], "date-cell");
    return new FakeLocator(this.panel, [], "generic");
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
    if (item.type === "picker") return "May 2026";
    if (item.type === "body") return "Booking body";
    if (item.type === "date") return item.text || "";
    return "";
  }

  async inputValue() {
    const item = this.items[0];
    if (!item) return "";
    if (item.type === "start") return this.panel.startDate;
    if (item.type === "end") return this.panel.endDate;
    return "";
  }

  async evaluate(fn, arg) {
    return fn({ className: "" }, arg);
  }

  async evaluateAll(fn) {
    return fn([]);
  }

  async getAttribute(name) {
    const item = this.items[0];
    if (!item) return null;
    if (item.type === "date") {
      if (name === "class") return "";
      if (name === "aria-label") return this.panel.dayTextOnly ? "" : item.date;
      return null;
    }
    return null;
  }

  async scrollIntoViewIfNeeded() {}

  async click() {
    const item = this.items[0];
    if (!item) return;
    if (item.type === "start" || item.type === "end") {
      this.panel.page.activeDateKind = item.type;
      return;
    }
    if (item.type === "date") {
      const kind = this.panel.page.activeDateKind;
      this.panel.page.dateClicks.push(`${kind}:${item.date}`);
      if (kind === "start") {
        this.panel.startDate = item.date;
        if (this.panel.autoFillEndOnStart) this.panel.endDate = item.date;
      }
      if (kind === "end" && !this.panel.suppressEndWrite) this.panel.endDate = item.date;
    }
  }

  page() {
    return this.panel.page;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
