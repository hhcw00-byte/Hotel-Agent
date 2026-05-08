"use strict";

const assert = require("assert");
const { SELECTORS } = require("./selectors");
const { selectRooms } = require("./room-select");

async function run() {
  await testSwitchChineseRoom();
  await testSwitchSingleRoom();
  await testOverlapRoomSelection();
  await testFailedUncheckDiagnostics();
  console.log("meituan room select state smoke passed");
}

async function testSwitchChineseRoom() {
  const page = new FakePage([
    { name: "豪华单人间", checked: true },
    { name: "精选单人间", checked: false }
  ]);
  await selectRooms(page, [{ roomName: "精选单人间", price: "374" }], { segmentIndex: 2 });
  assert.deepStrictEqual(page.checkedNames(), ["精选单人间"]);
}

async function testSwitchSingleRoom() {
  const page = new FakePage([
    { name: "A", checked: true },
    { name: "B", checked: false }
  ]);
  await selectRooms(page, [{ roomName: "B", price: "2" }], { segmentIndex: 1 });
  assert.deepStrictEqual(page.checkedNames(), ["B"]);
}

async function testOverlapRoomSelection() {
  const page = new FakePage([
    { name: "A", checked: true },
    { name: "B", checked: true },
    { name: "C", checked: false }
  ]);
  await selectRooms(page, [
    { roomName: "B", price: "2" },
    { roomName: "C", price: "3" }
  ], { segmentIndex: 2 });
  assert.deepStrictEqual(page.checkedNames(), ["B", "C"]);
}

async function testFailedUncheckDiagnostics() {
  const page = new FakePage([
    { name: "A", checked: true, blockToggle: true },
    { name: "B", checked: false }
  ]);
  let error;
  try {
    await selectRooms(page, [{ roomName: "B", price: "2" }], { segmentIndex: 3 });
  } catch (caught) {
    error = caught;
  }
  assert(error, "expected room selection mismatch");
  assert.strictEqual(error.code, "ROOM_SELECTION_MISMATCH");
  assert.deepStrictEqual(page.checkedNames(), ["A", "B"]);
  for (const field of [
    "platformCode",
    "segmentIndex",
    "requestedRooms",
    "previousSelectedRooms",
    "removedRooms",
    "newlySelectedRooms",
    "finalSelectedRooms",
    "unexpectedSelectedRooms",
    "missingSelectedRooms",
    "failedToggleRooms",
    "checkboxStateBeforeAfter"
  ]) {
    assert(Object.prototype.hasOwnProperty.call(error.diagnostics, field), `missing diagnostics.${field}`);
  }
  assert.strictEqual(error.diagnostics.platformCode, "meituan");
  assert.strictEqual(error.diagnostics.segmentIndex, 3);
  assert.deepStrictEqual(error.diagnostics.previousSelectedRooms, ["A"]);
  assert.deepStrictEqual(error.diagnostics.finalSelectedRooms, ["A", "B"]);
  assert.deepStrictEqual(error.diagnostics.unexpectedSelectedRooms, ["A"]);
  assert.strictEqual(error.diagnostics.failedToggleRooms.length, 1);
}

class FakePage {
  constructor(rows) {
    this.rows = rows.map((row) => ({ ...row }));
  }

  locator(selector) {
    if (selector === SELECTORS.roomBlock) return new RoomListLocator(this);
    return new EmptyLocator();
  }

  async waitForSelector() {}

  async waitForTimeout() {}

  checkedNames() {
    return this.rows.filter((row) => row.checked).map((row) => row.name);
  }
}

class RoomListLocator {
  constructor(page) {
    this.page = page;
  }

  async count() {
    return this.page.rows.length;
  }

  nth(index) {
    return new RowLocator(this.page, index);
  }
}

class RowLocator {
  constructor(page, index) {
    this.page = page;
    this.index = index;
  }

  get row() {
    return this.page.rows[this.index];
  }

  async isVisible() {
    return true;
  }

  locator(selector) {
    if (selector === SELECTORS.roomBaseName) return new TextLocator(this.row.name);
    if (selector === SELECTORS.roomProductCheckbox || selector === SELECTORS.roomCheckbox) return new CheckboxLocator(this.row);
    if (selector === SELECTORS.roomProductTitle) return new TextLocator(this.row.name);
    return new EmptyLocator();
  }

  async innerText() {
    return this.row.name;
  }

  async click() {
    toggleRow(this.row);
  }

  async getAttribute(name) {
    if (name === "class") return this.row.checked ? "selected" : "";
    return "";
  }
}

class TextLocator {
  constructor(text) {
    this.text = text;
  }

  first() {
    return this;
  }

  async count() {
    return 1;
  }

  async isVisible() {
    return true;
  }

  async innerText() {
    return this.text;
  }

  async getAttribute(name) {
    return name === "title" ? this.text : "";
  }
}

class CheckboxLocator {
  constructor(row) {
    this.row = row;
  }

  first() {
    return this;
  }

  async count() {
    return 1;
  }

  async scrollIntoViewIfNeeded() {}

  async click() {
    toggleRow(this.row);
  }

  locator() {
    return new WrapperLocator(this.row);
  }

  async evaluate(callback) {
    return callback(fakeInput(this.row));
  }
}

class WrapperLocator {
  constructor(row) {
    this.row = row;
  }

  first() {
    return this;
  }

  async isVisible() {
    return true;
  }

  async click() {
    toggleRow(this.row);
  }
}

class EmptyLocator {
  first() {
    return this;
  }

  nth() {
    return this;
  }

  async count() {
    return 0;
  }

  async isVisible() {
    return false;
  }

  async innerText() {
    return "";
  }

  async getAttribute() {
    return "";
  }
}

function fakeInput(row) {
  const node = () => ({
    className: row.checked ? "mtd-checkbox-checked" : "",
    querySelector: () => row.checked ? {} : null
  });
  return {
    checked: Boolean(row.checked),
    className: row.checked ? "mtd-checkbox-checked" : "",
    closest: node
  };
}

function toggleRow(row) {
  if (!row.blockToggle) row.checked = !row.checked;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
