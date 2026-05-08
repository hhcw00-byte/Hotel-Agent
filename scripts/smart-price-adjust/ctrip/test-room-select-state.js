"use strict";

const assert = require("assert");
const { SELECTORS } = require("./selectors");
const { selectRooms } = require("./room-select");

async function run() {
  await testSingleRoomReset();
  await testOverlapRoomReset();
  console.log("ctrip room selection state smoke passed");
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
  assert.deepStrictEqual(diagnostics.previousSelectedRooms, ["A", "B"]);
  assert.deepStrictEqual(diagnostics.removedRooms, ["A"]);
  assert.deepStrictEqual(diagnostics.newlySelectedRooms, ["C"]);
  assert.deepStrictEqual(diagnostics.finalSelectedRooms, ["B", "C"]);
  assert.deepStrictEqual(diagnostics.unexpectedSelectedRooms, []);
  assert.deepStrictEqual(diagnostics.missingSelectedRooms, []);
}

function room(roomName, price) {
  return { roomName, price };
}

class FakePage {
  constructor(roomNames) {
    this.rooms = roomNames.map((name) => ({ name, checked: false }));
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

  async isVisible() {
    return true;
  }

  locator(selector) {
    if (selector === SELECTORS.roomName) return new TextLocator(this.roomState.name);
    if (selector === SELECTORS.roomCheckbox) return new CheckboxLocator(this.roomState);
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
  constructor(roomState) {
    this.roomState = roomState;
  }

  first() {
    return this;
  }

  async count() {
    return 1;
  }

  async evaluate() {
    return this.roomState.checked;
  }

  async click() {
    this.roomState.checked = !this.roomState.checked;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
