"use strict";

const { SELECTORS, ALL_DAY_ROOM_TEXTS } = require("./selectors");
const { throwTripError, normalizeText, compactText } = require("./mapper");

async function selectRooms(page, rooms, options = {}) {
  await clickAllDayRoom(page);
  const requestedRooms = buildRequestedRooms(rooms);
  const diagnostics = buildSelectionDiagnostics(requestedRooms, options.segmentIndex);
  const previousStates = await collectRoomSelectionStates(page);
  diagnostics.previousSelectedRooms = selectedNames(previousStates);
  diagnostics.roomCandidates = summarizeRoomStates(previousStates);

  for (const state of previousStates) {
    if (!state.checked || roomMatchesAnyRequest(state.displayName, requestedRooms)) continue;
    const changed = await setRoomCheckedState(page, state, false, diagnostics);
    if (changed) diagnostics.removedRooms.push(state.displayName);
  }

  if (diagnostics.failedToggleRooms.length) {
    await finalizeSelectionDiagnostics(page, requestedRooms, diagnostics, options);
    throwTripError(
      "ROOM_SELECTION_MISMATCH",
      "match_room",
      "Trip room selection mismatch after segment reset.",
      diagnostics
    );
  }

  const selected = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const match = await findRoomNode(page, room.roomName);
    if (!match) {
      diagnostics.finalSelectedRooms = await collectSelectedRoomNames(page);
      diagnostics.missingSelectedRooms = missingRequestedRooms(requestedRooms, diagnostics.finalSelectedRooms);
      publishDiagnostics(options, diagnostics);
      throwTripError("ROOM_NOT_FOUND", "match_room", `Trip room not found: ${room.roomName}`);
    }
    const checkbox = match.node.locator(SELECTORS.roomCheckbox).first();
    if (!(await checkbox.count())) {
      diagnostics.finalSelectedRooms = await collectSelectedRoomNames(page);
      diagnostics.missingSelectedRooms = missingRequestedRooms(requestedRooms, diagnostics.finalSelectedRooms);
      publishDiagnostics(options, diagnostics);
      throwTripError("ROOM_NOT_FOUND", "match_room", `Trip room checkbox not found: ${room.roomName}`);
    }
    const wasChecked = await isChecked(match.node);
    const changed = await setRoomCheckedState(page, { ...match, checkbox, checked: wasChecked }, true, diagnostics);
    if (changed && !wasChecked) {
      diagnostics.newlySelectedRooms.push(match.displayName);
    }
    selected.push({
      roomIndex: index,
      roomName: room.roomName,
      matchedPlatformRoomName: match.displayName,
      matchStrategy: match.strategy
    });
  }

  await finalizeSelectionDiagnostics(page, requestedRooms, diagnostics, options);

  if (diagnostics.failedToggleRooms.length || diagnostics.unexpectedSelectedRooms.length || diagnostics.missingSelectedRooms.length) {
    throwTripError(
      "ROOM_SELECTION_MISMATCH",
      "match_room",
      "Trip room selection mismatch after segment reset.",
      diagnostics
    );
  }

  return selected;
}

async function clickAllDayRoom(page) {
  const direct = page.locator(SELECTORS.allDayRoomFilter).first();
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    await page.waitForTimeout(300);
    return;
  }

  for (const text of ALL_DAY_ROOM_TEXTS) {
    const tab = page.locator(SELECTORS.productFilter).getByText(text, { exact: true }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(300);
      return;
    }
  }

  const fallback = await findFilterByCompactText(page);
  if (fallback) {
    await fallback.click({ force: true });
    await page.waitForTimeout(300);
    return;
  }

  throwTripError("ROOM_NOT_FOUND", "match_room", "Trip all/all-day room filter not found.");
}

async function findFilterByCompactText(page) {
  const items = page.locator(`${SELECTORS.productFilter} *`);
  const targets = ALL_DAY_ROOM_TEXTS.map(compactText);
  const count = Math.min(await items.count().catch(() => 0), 80);
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = compactText(await item.innerText().catch(() => ""));
    if (text && targets.some((target) => text === target || text.includes(target))) return item;
  }
  return null;
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
      node,
      checkbox,
      checked: await isChecked(node)
    });
  }
  return states;
}

async function collectSelectedRoomNames(page) {
  return selectedNames(await collectRoomSelectionStates(page));
}

async function isChecked(locator) {
  const state = await readCheckedState(locator);
  return state.checked;
}

async function readCheckedState(locator) {
  const checkbox = locator.locator ? locator.locator(SELECTORS.roomCheckbox).first() : locator;
  return checkbox.evaluate((el) => {
    const input = el.matches && el.matches("input[type='checkbox']")
      ? el
      : el.querySelector && el.querySelector("input[type='checkbox']");
    if (input && input.checked === true) return { checked: true, source: "input.checked" };
    if (el.getAttribute("aria-checked") === "true") return { checked: true, source: "aria-checked" };
    const ariaChecked = el.querySelector && el.querySelector("[aria-checked='true']");
    if (ariaChecked) return { checked: true, source: "child-aria-checked" };
    const className = String(el.className || "");
    const parentClass = String(el.parentElement && el.parentElement.className || "");
    const classText = `${className} ${parentClass}`;
    if (/(^|\s|_|-)(checked|selected|active)(\s|_|-|$)/i.test(classText)) {
      return { checked: true, source: "class" };
    }
    const svg = el.querySelector && el.querySelector("svg");
    if (svg) return { checked: true, source: "svg" };
    return { checked: false, source: "none" };
  }).catch(() => ({ checked: false, source: "read_failed" }));
}

async function setRoomCheckedState(page, state, expectedChecked, diagnostics) {
  const before = await readCheckedState(state.node);
  if (before.checked === expectedChecked) return false;

  for (const target of buildClickTargets(state)) {
    if (!(await locatorExists(target.locator))) continue;
    const attemptBefore = await readCheckedState(state.node);
    if (attemptBefore.checked === expectedChecked) return true;

    let clickError = "";
    try {
      await target.locator.click({ force: true });
      diagnostics.clickedRooms.push({
        roomName: state.displayName,
        action: expectedChecked ? "select" : "remove",
        clickTarget: target.name
      });
    } catch (error) {
      clickError = error && error.message ? error.message : String(error);
    }

    const after = await waitForRoomCheckedState(page, state.node, expectedChecked);
    diagnostics.checkboxStateBeforeAfter.push({
      roomName: state.displayName,
      expectedChecked,
      before: attemptBefore.checked,
      beforeSource: attemptBefore.source,
      after: after.checked,
      afterSource: after.source,
      clickTarget: target.name,
      clickError
    });
    if (after.checked === expectedChecked) return true;
  }

  const finalState = await readCheckedState(state.node);
  diagnostics.failedToggleRooms.push({
    roomName: state.displayName,
    expectedChecked,
    before: before.checked,
    beforeSource: before.source,
    after: finalState.checked,
    afterSource: finalState.source
  });
  return false;
}

function buildClickTargets(state) {
  return [
    { name: "input", locator: state.node.locator("input[type='checkbox']").first() },
    { name: "checkbox", locator: state.checkbox },
    { name: "checkbox-inner", locator: state.node.locator(".he-trip-kit-ui-tree-checkbox-inner, .ant-tree-checkbox-inner").first() },
    { name: "room-node", locator: state.node }
  ];
}

async function locatorExists(locator) {
  if (!locator) return false;
  if (typeof locator.count !== "function") return true;
  return (await locator.count().catch(() => 0)) > 0;
}

async function waitForRoomCheckedState(page, node, expectedChecked) {
  let lastState = await readCheckedState(node);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (lastState.checked === expectedChecked) return lastState;
    await page.waitForTimeout(120);
    lastState = await readCheckedState(node);
  }
  return lastState;
}

async function finalizeSelectionDiagnostics(page, requestedRooms, diagnostics, options) {
  await page.waitForTimeout(300);
  const finalStates = await collectRoomSelectionStates(page);
  diagnostics.roomCandidates = summarizeRoomStates(finalStates);
  diagnostics.finalSelectedRooms = selectedNames(finalStates);
  diagnostics.unexpectedSelectedRooms = diagnostics.finalSelectedRooms
    .filter((name) => !roomMatchesAnyRequest(name, requestedRooms));
  diagnostics.missingSelectedRooms = missingRequestedRooms(requestedRooms, diagnostics.finalSelectedRooms);
  publishDiagnostics(options, diagnostics);
}

function stripRoomId(text) {
  return normalizeText(text).replace(/\([^)]*\)\s*$/, "").trim();
}

function buildRequestedRooms(rooms) {
  return (Array.isArray(rooms) ? rooms : []).map((room) => ({
    roomName: String(room && room.roomName || "").trim(),
    compactName: compactText(room && room.roomName)
  })).filter((room) => room.roomName && room.compactName);
}

function buildSelectionDiagnostics(requestedRooms, segmentIndex) {
  return {
    platformCode: "trip",
    segmentIndex: Number.isInteger(segmentIndex) ? segmentIndex : null,
    requestedRooms: requestedRooms.map((room) => room.roomName),
    previousSelectedRooms: [],
    removedRooms: [],
    newlySelectedRooms: [],
    finalSelectedRooms: [],
    unexpectedSelectedRooms: [],
    missingSelectedRooms: [],
    roomCandidates: [],
    clickedRooms: [],
    failedToggleRooms: [],
    checkboxStateBeforeAfter: []
  };
}

function summarizeRoomStates(states) {
  return states.map((state) => ({
    roomName: state.displayName,
    checked: Boolean(state.checked)
  }));
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

module.exports = {
  selectRooms
};
