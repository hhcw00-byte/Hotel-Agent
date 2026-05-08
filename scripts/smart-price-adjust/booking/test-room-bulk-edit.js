"use strict";

const assert = require("assert");
const {
  openBulkEditForRoom,
  closeAnyBulkEditPanel,
  normalizeBookingRoomName
} = require("./bulk-edit");

const DOUBLE = "\u53cc\u4eba\u95f4";
const SINGLE = "\u5355\u4eba\u95f4";
const QUAD = "\u56db\u4eba\u95f4";

async function main() {
  await testClicksRequestedRoomOnly();
  await testIgnoresDateHeaderContent();
  await testRoomNotFound();
  await testAmbiguousRoomName();
  await testDifferentRoomsAlwaysOpenOwnBulkEdit();
  await testPanelDetectionFallsBackToBodyMarker();
  assert.strictEqual(normalizeBookingRoomName(`${DOUBLE}\uff08\u5ba2\u623fID\uff1a1636074001\uff09`), DOUBLE);
  assert.strictEqual(normalizeBookingRoomName("Double Room (Room ID: 1636074001)"), "Double Room");
  console.log("booking room bulk edit smoke passed");
}

async function testClicksRequestedRoomOnly() {
  const page = new FakePage([
    room("room-1636074001", `${DOUBLE}\uff08\u5ba2\u623fID\uff1a1636074001\uff09`),
    room("room-1636074002", `${SINGLE}\uff08\u5ba2\u623fID\uff1a1636074002\uff09`),
    room("room-1636074003", `${QUAD}\uff08\u5ba2\u623fID\uff1a1636074003\uff09`)
  ]);
  const result = await openBulkEditForRoom(page, SINGLE, { segmentIndex: 1 });
  assert.strictEqual(result.matchedRoomName, SINGLE);
  assert.strictEqual(result.diagnostics.selectedRoomBlockTestId, "room-1636074002");
  assert.deepStrictEqual(page.clicks(), [0, 1, 0]);
  assert.strictEqual(page.globalBulkEditQueries, 0, "should not query global first bulk edit button");
}

async function testIgnoresDateHeaderContent() {
  const page = new FakePage([
    room("room-1636074001", DOUBLE),
    room("room-1636074002", SINGLE),
    room("room-1636074003", QUAD)
  ], { dateHeaderText: `${SINGLE} 2026-05-25` });
  const result = await openBulkEditForRoom(page, SINGLE, { segmentIndex: 2 });
  assert.strictEqual(result.diagnostics.roomBlockCount, 3);
  assert.strictEqual(result.diagnostics.selectedRoomBlockTestId, "room-1636074002");
  assert.strictEqual(page.dateHeaderContentQueries, 0, "date header .av-cal-list-content should not be scanned");
}

async function testRoomNotFound() {
  const page = new FakePage([room("room-1", DOUBLE), room("room-2", SINGLE), room("room-3", QUAD)]);
  const error = await captureError(() => openBulkEditForRoom(page, "\u5957\u623f", { segmentIndex: 3 }));
  assert.strictEqual(error.code, "ROOM_NOT_FOUND");
  assert.strictEqual(error.diagnostics.roomBlockCount, 3);
  assert.ok(error.diagnostics.roomCandidates.some((item) => item.normalizedTitle === DOUBLE));
}

async function testAmbiguousRoomName() {
  const page = new FakePage([
    room("room-1", `\u6807\u51c6${SINGLE}`),
    room("room-2", `\u8c6a\u534e${SINGLE}`),
    room("room-3", QUAD)
  ]);
  const error = await captureError(() => openBulkEditForRoom(page, SINGLE, { segmentIndex: 4 }));
  assert.strictEqual(error.code, "ROOM_NAME_AMBIGUOUS");
  assert.strictEqual(error.diagnostics.ambiguousMatches.length, 2);
}

async function testDifferentRoomsAlwaysOpenOwnBulkEdit() {
  const page = new FakePage([room("room-1", SINGLE), room("room-2", DOUBLE), room("room-3", QUAD)]);
  await openBulkEditForRoom(page, SINGLE, { segmentIndex: 5 });
  await closeAnyBulkEditPanel(page);
  await openBulkEditForRoom(page, DOUBLE, { segmentIndex: 6 });
  await closeAnyBulkEditPanel(page);
  await openBulkEditForRoom(page, QUAD, { segmentIndex: 7 });
  assert.deepStrictEqual(page.clicks(), [1, 1, 1]);
  assert.strictEqual(page.currentClickedRoomBlockTestId, "room-3");
}

async function testPanelDetectionFallsBackToBodyMarker() {
  const page = new FakePage([room("room-1", SINGLE)], { noPanelContainers: true });
  const result = await openBulkEditForRoom(page, SINGLE, { segmentIndex: 8 });
  assert.strictEqual(result.matchedRoomName, SINGLE);
  assert.strictEqual(result.diagnostics.bulkEditPanelOpened, true);
  assert.deepStrictEqual(page.clicks(), [1]);
}

function room(testId, title) {
  return { testId, title, clickCount: 0 };
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
  constructor(rooms, options = {}) {
    this.rooms = rooms;
    this.panelOpen = false;
    this.currentClickedRoomBlockTestId = "";
    this.globalBulkEditQueries = 0;
    this.dateHeaderContentQueries = 0;
    this.dateHeaderText = options.dateHeaderText || "2026-05-25";
    this.noPanelContainers = Boolean(options.noPanelContainers);
    this.keyboard = {
      press: async (key) => {
        if (key === "Escape") this.panelOpen = false;
      }
    };
  }

  locator(selector) {
    if (selector.includes("av-cal-list-content")) {
      this.dateHeaderContentQueries += 1;
      return new FakeLocator(this, [{ title: this.dateHeaderText, testId: "scroll-sync" }], "date-header");
    }
    if (selector.includes(".av-cal-list-room[data-test-id^=\"room-\"]")) {
      return new FakeLocator(this, this.rooms, "room-block");
    }
    if (selector.includes("general-modal-cta")) {
      this.globalBulkEditQueries += 1;
      return new FakeLocator(this, []);
    }
    if (selector.includes("date-from") || selector.includes("date-until") || selector.includes("price-input-0")) {
      return new FakeLocator(this, this.panelOpen ? [{ title: selector }] : [], "marker");
    }
    if (selector.includes("[role=\"dialog\"]") || selector === "aside" || selector === "section") {
      if (this.noPanelContainers) return new FakeLocator(this, []);
      return new FakeLocator(this, this.panelOpen ? [{ title: "Bulk edit panel" }] : [], "panel");
    }
    if (selector === "body") return new FakeLocator(this, [{ title: "body" }], "body");
    return new FakeLocator(this, []);
  }

  async waitForTimeout() {}

  url() {
    return "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html";
  }

  clicks() {
    return this.rooms.map((item) => item.clickCount);
  }
}

class FakeLocator {
  constructor(page, items, kind = "generic") {
    this._page = page;
    this.items = items || [];
    this.kind = kind;
  }

  first() {
    return this.nth(0);
  }

  nth(index) {
    return new FakeLocator(this._page, this.items[index] ? [this.items[index]] : [], this.kind);
  }

  async count() {
    return this.items.length;
  }

  async isVisible() {
    return this.items.length > 0;
  }

  async textContent() {
    const item = this.items[0];
    return item ? item.title : "";
  }

  async innerText() {
    return this.textContent();
  }

  locator(selector) {
    const item = this.items[0];
    if (!item) return new FakeLocator(this._page, []);
    if (selector.includes("room__title") || selector.includes("room-name")) {
      return new FakeLocator(this._page, [item], "title");
    }
    if (selector.includes("general-modal-cta")) {
      return new FakeLocator(this._page, [item], "bulk-button");
    }
    if (selector.includes("date-from") || selector.includes("date-until") || selector.includes("price-input-0")) {
      return new FakeLocator(this._page, this._page.panelOpen ? [item] : [], "marker");
    }
    if (/Close|Cancel|\u5173\u95ed|\u53d6\u6d88/i.test(selector)) {
      return new FakeLocator(this._page, this._page.panelOpen ? [{ title: "close" }] : [], "close");
    }
    return this._page.locator(selector);
  }

  async scrollIntoViewIfNeeded() {}

  async click() {
    const item = this.items[0];
    if (!item) return;
    if (this.kind === "close") {
      this._page.panelOpen = false;
      return;
    }
    if (this.kind === "bulk-button") {
      item.clickCount += 1;
      this._page.panelOpen = true;
      this._page.currentClickedRoomBlockTestId = item.testId || "";
    }
  }

  async evaluate() {
    return "";
  }

  async getAttribute(name) {
    const item = this.items[0];
    return name === "data-test-id" && item ? item.testId || "" : "";
  }

  page() {
    return this._page;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
