"use strict";

const assert = require("assert");
const { SELECTORS } = require("./selectors");
const { selectRooms } = require("./room-select");

async function run() {
  await testSingleRoomReset();
  await testOverlapRoomReset();
  await testRealObservedReset();
  await testToggleFailureDiagnostics();
  await testCheckedStateSources();
  console.log("trip room selection state smoke passed");
}

async function testSingleRoomReset() {
  const page = new FakePage(["A", "B", "C"]);
  await selectRooms(page, [room("A", "392")], { segmentIndex: 0, diagnostics: {} });

  const diagnostics = {};
  await selectRooms(page, [room("B", "345")], { segmentIndex: 1, diagnostics });

  assert.deepStrictEqual(page.checkedRoomNames(), ["B"]);
  assert.deepStrictEqual(diagnostics.previousSelectedRooms, ["A"]);
  assert.deepStrictEqual(diagnostics.removedRooms, ["A"]);
  assert.deepStrictEqual(diagnostics.newlySelectedRooms, ["B"]);
  assert.deepStrictEqual(diagnostics.finalSelectedRooms, ["B"]);
  assert.deepStrictEqual(diagnostics.unexpectedSelectedRooms, []);
  assert.deepStrictEqual(diagnostics.missingSelectedRooms, []);
}

async function testOverlapRoomReset() {
  const page = new FakePage(["A", "B", "C"]);
  await selectRooms(page, [room("A", "392"), room("B", "393")], { segmentIndex: 0, diagnostics: {} });

  const diagnostics = {};
  await selectRooms(page, [room("B", "345"), room("C", "346")], { segmentIndex: 1, diagnostics });

  assert.deepStrictEqual(page.checkedRoomNames(), ["B", "C"]);
  assert.deepStrictEqual(diagnostics.requestedRooms, ["B", "C"]);
  assert.deepStrictEqual(diagnostics.previousSelectedRooms, ["A", "B"]);
  assert.deepStrictEqual(diagnostics.removedRooms, ["A"]);
  assert.deepStrictEqual(diagnostics.newlySelectedRooms, ["C"]);
  assert.deepStrictEqual(diagnostics.finalSelectedRooms, ["B", "C"]);
  assert.deepStrictEqual(diagnostics.unexpectedSelectedRooms, []);
  assert.deepStrictEqual(diagnostics.missingSelectedRooms, []);
}

async function testRealObservedReset() {
  const deluxe = "豪华单人间【公区洗衣房+公共卫浴+独享空间】";
  const selected = "精选单人间";
  const page = new FakePage([
    { name: deluxe, checked: true, readMode: "class", clickableTargets: ["checkbox"] },
    { name: selected, checked: false, readMode: "aria", clickableTargets: ["checkbox"] }
  ]);

  const diagnostics = {};
  await selectRooms(page, [room(selected, "344")], { segmentIndex: 1, diagnostics });

  assert.deepStrictEqual(page.checkedRoomNames(), [selected]);
  assert.deepStrictEqual(diagnostics.previousSelectedRooms, [deluxe]);
  assert.deepStrictEqual(diagnostics.removedRooms, [deluxe]);
  assert.deepStrictEqual(diagnostics.newlySelectedRooms, [selected]);
  assert.deepStrictEqual(diagnostics.finalSelectedRooms, [selected]);
  assert.strictEqual(diagnostics.failedToggleRooms.length, 0);
  assert(diagnostics.clickedRooms.some((item) => item.roomName === deluxe && item.action === "remove"));
}

async function testToggleFailureDiagnostics() {
  const diagnostics = {};
  const page = new FakePage([
    { name: "豪华单人间", checked: true, clickLocked: true },
    { name: "精选单人间", checked: false }
  ]);

  await assert.rejects(
    () => selectRooms(page, [room("精选单人间", "344")], { segmentIndex: 1, diagnostics }),
    (error) => error && error.code === "ROOM_SELECTION_MISMATCH"
  );

  assert.deepStrictEqual(diagnostics.previousSelectedRooms, ["豪华单人间"]);
  assert.deepStrictEqual(diagnostics.finalSelectedRooms, ["豪华单人间"]);
  assert.deepStrictEqual(diagnostics.unexpectedSelectedRooms, ["豪华单人间"]);
  assert.deepStrictEqual(diagnostics.missingSelectedRooms, ["精选单人间"]);
  assert.strictEqual(diagnostics.failedToggleRooms.length, 1);
  assert.strictEqual(diagnostics.failedToggleRooms[0].roomName, "豪华单人间");
  assertCompleteDiagnostics(diagnostics);
}

async function testCheckedStateSources() {
  const page = new FakePage([
    { name: "InputRoom", checked: true, readMode: "input" },
    { name: "AriaRoom", checked: true, readMode: "aria" },
    { name: "ClassRoom", checked: true, readMode: "class" },
    { name: "ParentClassRoom", checked: true, readMode: "parentClass" },
    { name: "SvgRoom", checked: true, readMode: "svg" },
    { name: "TargetRoom", checked: false }
  ]);

  const diagnostics = {};
  await selectRooms(page, [room("TargetRoom", "344")], { segmentIndex: 2, diagnostics });

  assert.deepStrictEqual(diagnostics.previousSelectedRooms, [
    "InputRoom",
    "AriaRoom",
    "ClassRoom",
    "ParentClassRoom",
    "SvgRoom"
  ]);
  assert.deepStrictEqual(page.checkedRoomNames(), ["TargetRoom"]);
}

function assertCompleteDiagnostics(diagnostics) {
  for (const field of [
    "requestedRooms",
    "previousSelectedRooms",
    "removedRooms",
    "newlySelectedRooms",
    "finalSelectedRooms",
    "unexpectedSelectedRooms",
    "missingSelectedRooms",
    "roomCandidates",
    "clickedRooms",
    "failedToggleRooms",
    "checkboxStateBeforeAfter",
    "segmentIndex",
    "platformCode"
  ]) {
    assert(Object.prototype.hasOwnProperty.call(diagnostics, field), `missing diagnostics field: ${field}`);
  }
}

function room(roomName, price) {
  return { roomName, price };
}

class FakePage {
  constructor(roomSpecs) {
    this.rooms = roomSpecs.map((spec) => {
      const value = typeof spec === "string" ? { name: spec } : spec;
      return {
        name: value.name,
        checked: Boolean(value.checked),
        readMode: value.readMode || "input",
        clickLocked: Boolean(value.clickLocked),
        clickableTargets: value.clickableTargets || ["input", "checkbox", "checkbox-inner", "room-node"]
      };
    });
  }

  locator(selector) {
    if (selector === SELECTORS.allDayRoomFilter) return new StaticLocator(1);
    if (selector === SELECTORS.productFilter) return new ProductFilterLocator();
    if (selector === SELECTORS.roomNode) return new RoomListLocator(this.rooms);
    return new StaticLocator(0);
  }

  async waitForSelector(selector) {
    if (selector !== SELECTORS.roomTree) throw new Error(`Unexpected selector: ${selector}`);
  }

  async waitForTimeout() {}

  checkedRoomNames() {
    return this.rooms.filter((roomState) => roomState.checked).map((roomState) => roomState.name);
  }
}

class StaticLocator {
  constructor(count) {
    this._count = count;
  }

  first() {
    return this;
  }

  async count() {
    return this._count;
  }

  async isVisible() {
    return this._count > 0;
  }

  async click() {}
}

class ProductFilterLocator extends StaticLocator {
  constructor() {
    super(1);
  }

  getByText() {
    return this;
  }
}

class RoomListLocator {
  constructor(rooms) {
    this.rooms = rooms;
  }

  async count() {
    return this.rooms.length;
  }

  nth(index) {
    return new RoomNodeLocator(this.rooms[index]);
  }
}

class RoomNodeLocator {
  constructor(roomState) {
    this.roomState = roomState;
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

  async click() {
    toggleRoom(this.roomState, "room-node");
  }

  locator(selector) {
    if (selector === SELECTORS.roomName) return new TextLocator(this.roomState.name);
    if (selector === SELECTORS.roomCheckbox) return new CheckboxLocator(this.roomState, "checkbox");
    if (selector === "input[type='checkbox']") return new CheckboxLocator(this.roomState, "input");
    if (selector === ".he-trip-kit-ui-tree-checkbox-inner, .ant-tree-checkbox-inner") {
      return new CheckboxLocator(this.roomState, "checkbox-inner");
    }
    return new StaticLocator(0);
  }
}

class TextLocator {
  constructor(text) {
    this.text = text;
  }

  first() {
    return this;
  }

  async innerText() {
    return this.text;
  }
}

class CheckboxLocator {
  constructor(roomState, targetName) {
    this.roomState = roomState;
    this.targetName = targetName;
  }

  first() {
    return this;
  }

  async count() {
    return 1;
  }

  async evaluate(fn) {
    return fn(new FakeCheckboxElement(this.roomState));
  }

  async click() {
    toggleRoom(this.roomState, this.targetName);
  }
}

class FakeCheckboxElement {
  constructor(roomState) {
    this.roomState = roomState;
    this.checked = roomState.readMode === "input" ? roomState.checked : false;
    this.className = roomState.checked && roomState.readMode === "class" ? "ant-tree-checkbox ant-tree-checkbox-checked" : "ant-tree-checkbox";
    this.parentElement = {
      className: roomState.checked && roomState.readMode === "parentClass" ? "ant-tree-treenode selected" : "ant-tree-treenode"
    };
  }

  matches(selector) {
    return selector === "input[type='checkbox']" && this.roomState.readMode === "input";
  }

  getAttribute(name) {
    if (name === "aria-checked" && this.roomState.readMode === "aria") {
      return this.roomState.checked ? "true" : "false";
    }
    return null;
  }

  querySelector(selector) {
    if (selector === "input[type='checkbox']") {
      return { checked: this.roomState.readMode === "input" ? this.roomState.checked : false };
    }
    if (selector === "[aria-checked='true']") {
      return this.roomState.readMode === "childAria" && this.roomState.checked ? {} : null;
    }
    if (selector === "svg") {
      return this.roomState.readMode === "svg" && this.roomState.checked ? {} : null;
    }
    return null;
  }
}

function toggleRoom(roomState, targetName) {
  if (roomState.clickLocked) return;
  if (!roomState.clickableTargets.includes(targetName)) return;
  roomState.checked = !roomState.checked;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
