"use strict";

const { SELECTORS } = require("./selectors");
const { throwCtripError, normalizeText, compactText } = require("./mapper");

async function selectRooms(page, rooms, options = {}) {
  await clickAllDayRoom(page);
  const requestedRooms = buildRequestedRooms(rooms);
  const diagnostics = buildSelectionDiagnostics(requestedRooms, options.segmentIndex);
  const previousStates = await collectRoomSelectionStates(page);
  diagnostics.previousSelectedRooms = selectedNames(previousStates);

  for (const state of previousStates) {
    if (!state.checked || roomMatchesAnyRequest(state.displayName, requestedRooms)) continue;
    await state.checkbox.click({ force: true });
    await page.waitForTimeout(150);
    diagnostics.removedRooms.push(state.displayName);
  }

  const selected = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const match = await findRoomNode(page, room.roomName);
    if (!match) {
      diagnostics.finalSelectedRooms = await collectSelectedRoomNames(page);
      diagnostics.missingSelectedRooms = missingRequestedRooms(requestedRooms, diagnostics.finalSelectedRooms);
      publishDiagnostics(options, diagnostics);
      throwCtripError("ROOM_NOT_FOUND", "match_room", `Ctrip room not found: ${room.roomName}`);
    }
    const checkbox = match.node.locator(SELECTORS.roomCheckbox).first();
    if (!(await checkbox.count())) {
      diagnostics.finalSelectedRooms = await collectSelectedRoomNames(page);
      diagnostics.missingSelectedRooms = missingRequestedRooms(requestedRooms, diagnostics.finalSelectedRooms);
      publishDiagnostics(options, diagnostics);
      throwCtripError("ROOM_NOT_FOUND", "match_room", `Ctrip room checkbox not found: ${room.roomName}`);
    }
    if (!(await isChecked(checkbox))) {
      await checkbox.click({ force: true });
      await page.waitForTimeout(150);
      diagnostics.newlySelectedRooms.push(match.displayName);
    }
    selected.push({
      roomIndex: index,
      roomName: room.roomName,
      matchedPlatformRoomName: match.displayName,
      matchStrategy: match.strategy
    });
  }

  await page.waitForTimeout(300);
  diagnostics.finalSelectedRooms = await collectSelectedRoomNames(page);
  diagnostics.unexpectedSelectedRooms = diagnostics.finalSelectedRooms
    .filter((name) => !roomMatchesAnyRequest(name, requestedRooms));
  diagnostics.missingSelectedRooms = missingRequestedRooms(requestedRooms, diagnostics.finalSelectedRooms);
  publishDiagnostics(options, diagnostics);

  if (diagnostics.unexpectedSelectedRooms.length || diagnostics.missingSelectedRooms.length) {
    throwCtripError(
      "ROOM_SELECTION_MISMATCH",
      "match_room",
      "Ctrip room selection mismatch after segment reset.",
      diagnostics
    );
  }

  return selected;
}

async function clickAllDayRoom(page) {
  let tab = page.locator(SELECTORS.allDayRoomFilter).first();
  if (!(await tab.count())) {
    tab = page.locator(SELECTORS.productFilter).getByText("全日房", { exact: true }).first();
  }
  if (!(await tab.count())) {
    throwCtripError("ROOM_NOT_FOUND", "match_room", "Ctrip all-day room filter not found.");
  }
  await tab.click();
  await page.waitForTimeout(300);
}

async function findRoomNode(page, roomName) {
  await page.waitForSelector(SELECTORS.roomTree, { timeout: 5000 });
  const nodes = page.locator(SELECTORS.roomNode);
  const target = compactText(roomName);
  const count = Math.min(await nodes.count(), 200);
  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index);
    if (!(await node.isVisible().catch(() => false))) continue;
    const rawName = normalizeText(await node.locator(SELECTORS.roomName).first().innerText().catch(() => ""));
    const displayName = stripRoomId(rawName);
    const compactName = compactText(displayName);
    if (compactName === target || compactName.includes(target)) {
      return { node, displayName, strategy: compactName === target ? "exact" : "contains" };
    }
  }
  return null;
}

async function collectRoomSelectionStates(page) {
  await page.waitForSelector(SELECTORS.roomTree, { timeout: 5000 });
  const nodes = page.locator(SELECTORS.roomNode);
  const states = [];
  const count = Math.min(await nodes.count(), 200);
  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index);
    if (!(await node.isVisible().catch(() => false))) continue;
    const checkbox = node.locator(SELECTORS.roomCheckbox).first();
    if (!(await checkbox.count().catch(() => 0))) continue;
    const rawName = normalizeText(await node.locator(SELECTORS.roomName).first().innerText().catch(() => ""));
    const displayName = stripRoomId(rawName);
    if (!displayName) continue;
    states.push({
      displayName,
      checkbox,
      checked: await isChecked(checkbox)
    });
  }
  return states;
}

async function collectSelectedRoomNames(page) {
  return selectedNames(await collectRoomSelectionStates(page));
}

async function isChecked(locator) {
  return locator.evaluate((el) => {
    const className = String(el.className || "");
    return className.includes("checked") || el.getAttribute("aria-checked") === "true";
  }).catch(() => false);
}

function buildRequestedRooms(rooms) {
  return (Array.isArray(rooms) ? rooms : []).map((room) => ({
    roomName: String(room && room.roomName || "").trim(),
    compactName: compactText(room && room.roomName)
  })).filter((room) => room.roomName && room.compactName);
}

function buildSelectionDiagnostics(requestedRooms, segmentIndex) {
  return {
    platformCode: "ctrip",
    segmentIndex: Number.isInteger(segmentIndex) ? segmentIndex : null,
    requestedRooms: requestedRooms.map((room) => room.roomName),
    previousSelectedRooms: [],
    removedRooms: [],
    newlySelectedRooms: [],
    finalSelectedRooms: [],
    unexpectedSelectedRooms: [],
    missingSelectedRooms: []
  };
}

function selectedNames(states) {
  return states.filter((state) => state.checked).map((state) => state.displayName);
}

function missingRequestedRooms(requestedRooms, selectedRoomNames) {
  return requestedRooms
    .filter((room) => !selectedRoomNames.some((selectedName) => roomMatchesRequest(selectedName, room)))
    .map((room) => room.roomName);
}

function roomMatchesAnyRequest(displayName, requestedRooms) {
  return requestedRooms.some((room) => roomMatchesRequest(displayName, room));
}

function roomMatchesRequest(displayName, requestedRoom) {
  const display = compactText(displayName);
  return Boolean(display && requestedRoom && requestedRoom.compactName && (
    display === requestedRoom.compactName || display.includes(requestedRoom.compactName)
  ));
}

function publishDiagnostics(options, diagnostics) {
  if (options && options.diagnostics && typeof options.diagnostics === "object") {
    Object.assign(options.diagnostics, diagnostics);
  }
}

function stripRoomId(text) {
  return normalizeText(text).replace(/\([^)]*\)\s*$/, "").trim();
}

module.exports = {
  selectRooms,
  buildRequestedRooms,
  missingRequestedRooms,
  roomMatchesRequest
};
