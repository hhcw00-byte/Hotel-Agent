"use strict";

const { SELECTORS } = require("./selectors");
const {
  baseName,
  compactText,
  normalizeName,
  scoreMatch,
  throwMeituanError
} = require("./mapper");

async function selectRooms(page, rooms, options = {}) {
  const selected = [];
  const roomList = Array.isArray(rooms) ? rooms : [];
  const requestedRooms = roomList.map((room) => String(room && room.roomName || "").trim()).filter(Boolean);
  const diagnostics = createSelectionDiagnostics(requestedRooms, options);
  await page.waitForSelector(SELECTORS.roomBlock, { timeout: 5000 });

  let states = await collectRoomSelectionStates(page);
  diagnostics.previousSelectedRooms = selectedNames(states);

  for (const state of states) {
    if (state.checked && !roomMatchesAnyRequest(state.displayName, requestedRooms)) {
      const changed = await setRoomChecked(page, state, false, diagnostics);
      if (changed) diagnostics.removedRooms.push(state.displayName);
    }
  }

  for (let index = 0; index < roomList.length; index += 1) {
    const room = roomList[index] || {};
    const roomName = String(room.roomName || "").trim();
    const match = await findRoomCandidate(page, roomName);
    if (!match) {
      await finalizeSelectionDiagnostics(page, requestedRooms, diagnostics);
      throwMeituanError("ROOM_NOT_FOUND", "match_room", `Meituan room not found: ${roomName}`, {
        ...diagnostics,
        roomName,
        visibleRoomNames: await collectRoomNames(page),
        visibleProductTitles: await collectProductTitles(page)
      });
    }

    const state = await buildRoomState(match.row, match.displayName);
    if (!state) {
      await finalizeSelectionDiagnostics(page, requestedRooms, diagnostics);
      throwMeituanError("ROOM_NOT_FOUND", "match_room", `Meituan room checkbox not found: ${roomName}`, {
        ...diagnostics,
        roomName,
        matchedPlatformRoomName: match.displayName,
        visibleRoomNames: await collectRoomNames(page),
        visibleProductTitles: await collectProductTitles(page)
      });
    }
    const wasChecked = await isRoomChecked(state.row, state.checkbox);
    if (!wasChecked) {
      const changed = await setRoomChecked(page, state, true, diagnostics);
      if (changed) diagnostics.newlySelectedRooms.push(state.displayName);
    }

    selected.push({
      roomIndex: index,
      roomName,
      matchedPlatformRoomName: match.displayName,
      matchStrategy: match.strategy
    });
  }

  await page.waitForTimeout(300).catch(() => {});
  await finalizeSelectionDiagnostics(page, requestedRooms, diagnostics);
  if (diagnostics.failedToggleRooms.length || diagnostics.unexpectedSelectedRooms.length || diagnostics.missingSelectedRooms.length) {
    throwMeituanError(
      "ROOM_SELECTION_MISMATCH",
      "match_room",
      "Meituan room selection mismatch after segment reset.",
      diagnostics
    );
  }

  return selected;
}

async function findRoomCandidate(page, roomName) {
  const rows = page.locator(SELECTORS.roomBlock);
  const target = normalizeName(roomName);
  const targetBase = baseName(roomName);
  const count = Math.min(await rows.count().catch(() => 0), 200);
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const displayName = await readRoomDisplayName(row);
    if (!displayName) continue;
    const normalized = normalizeName(displayName);
    const base = baseName(displayName);
    const score = scoreMatch({ normalized, base }, { target, targetBase });
    if (score <= 0) continue;
    candidates.push({
      row,
      displayName,
      score,
      strategy: score >= 400
        ? "exact"
        : score >= 300
          ? "base_exact"
          : score >= 200
            ? "contains"
            : "base_contains"
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] || null;
}

async function readRoomDisplayName(row) {
  const name = await row.locator(SELECTORS.roomBaseName).first().innerText().catch(() => "");
  const text = String(name || "").trim() || await row.innerText().catch(() => "");
  return compactText(text);
}

async function collectRoomSelectionStates(page) {
  const rows = page.locator(SELECTORS.roomBlock);
  const count = Math.min(await rows.count().catch(() => 0), 200);
  const states = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const displayName = await readRoomDisplayName(row);
    if (!displayName) continue;
    const state = await buildRoomState(row, displayName);
    if (state) states.push(state);
  }
  return states;
}

async function buildRoomState(row, displayName) {
  const checkbox = await resolveRoomCheckbox(row);
  if (!checkbox) return null;
  return {
    row,
    checkbox,
    displayName,
    checked: await isRoomChecked(row, checkbox)
  };
}

async function resolveRoomCheckbox(row) {
  const checkbox = row.locator(SELECTORS.roomProductCheckbox).first();
  if (await checkbox.count().catch(() => 0)) return checkbox;
  const fallback = row.locator(SELECTORS.roomCheckbox).first();
  return (await fallback.count().catch(() => 0)) ? fallback : null;
}

async function setRoomChecked(page, state, expectedChecked, diagnostics) {
  const before = await isRoomChecked(state.row, state.checkbox);
  if (before === expectedChecked) return true;

  await state.checkbox.scrollIntoViewIfNeeded().catch(() => {});
  await state.checkbox.click({ force: true }).catch(async () => {
    const wrapper = state.checkbox.locator("xpath=ancestor::label[contains(@class,'mtd-checkbox')][1]").first();
    if (await wrapper.isVisible().catch(() => false)) {
      await wrapper.click({ force: true }).catch(() => {});
    } else {
      await state.row.click({ force: true }).catch(() => {});
    }
  });

  const after = await waitForRoomCheckedState(page, state, expectedChecked);
  diagnostics.checkboxStateBeforeAfter.push({
    roomName: state.displayName,
    expectedChecked,
    before,
    after
  });
  if (after === expectedChecked) return true;

  diagnostics.failedToggleRooms.push({
    roomName: state.displayName,
    expectedChecked,
    before,
    after
  });
  return false;
}

async function waitForRoomCheckedState(page, state, expectedChecked) {
  let checked = await isRoomChecked(state.row, state.checkbox);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (checked === expectedChecked) return checked;
    await page.waitForTimeout(120).catch(() => {});
    checked = await isRoomChecked(state.row, state.checkbox);
  }
  return checked;
}

async function finalizeSelectionDiagnostics(page, requestedRooms, diagnostics) {
  const finalStates = await collectRoomSelectionStates(page);
  diagnostics.finalSelectedRooms = selectedNames(finalStates);
  diagnostics.unexpectedSelectedRooms = diagnostics.finalSelectedRooms
    .filter((name) => !roomMatchesAnyRequest(name, requestedRooms));
  diagnostics.missingSelectedRooms = missingRequestedRooms(requestedRooms, diagnostics.finalSelectedRooms);
}

function selectedNames(states) {
  return states.filter((state) => state.checked).map((state) => state.displayName);
}

function missingRequestedRooms(requestedRooms, selectedRooms) {
  return requestedRooms.filter((roomName) => !selectedRooms.some((selected) => roomMatchesRequest(selected, roomName)));
}

function roomMatchesAnyRequest(displayName, requestedRooms) {
  return requestedRooms.some((roomName) => roomMatchesRequest(displayName, roomName));
}

function roomMatchesRequest(displayName, roomName) {
  const candidate = {
    normalized: normalizeName(displayName),
    base: baseName(displayName)
  };
  const target = {
    target: normalizeName(roomName),
    targetBase: baseName(roomName)
  };
  return scoreMatch(candidate, target) > 0;
}

function createSelectionDiagnostics(requestedRooms, options = {}) {
  return {
    platformCode: "meituan",
    segmentIndex: Number.isInteger(options.segmentIndex) ? options.segmentIndex : null,
    requestedRooms,
    previousSelectedRooms: [],
    removedRooms: [],
    newlySelectedRooms: [],
    finalSelectedRooms: [],
    unexpectedSelectedRooms: [],
    missingSelectedRooms: [],
    failedToggleRooms: [],
    checkboxStateBeforeAfter: []
  };
}

async function isRoomChecked(row, checkbox) {
  return checkbox.evaluate((input) => {
    const nodes = [
      input,
      input && input.closest("label.mtd-checkbox"),
      input && input.closest(".mtd-checkbox"),
      input && input.closest(".room-goods-item-goods-item"),
      input && input.closest(".room-goods-item")
    ].filter(Boolean);
    return Boolean(
      input && input.checked
      || nodes.some((node) => {
        const classText = String(node.className || "").toLowerCase();
        return classText.includes("mtd-checkbox-checked")
          || /\b(checked|selected|active)\b/.test(classText)
          || Boolean(node.querySelector && node.querySelector(".mtd-checkbox-checked"));
      })
    );
  }).catch(async () => {
    const classText = String(await row.getAttribute("class").catch(() => "") || "").toLowerCase();
    return /\b(checked|selected|active)\b/.test(classText);
  });
}

async function collectRoomNames(page) {
  const rows = page.locator(SELECTORS.roomBlock);
  const count = Math.min(await rows.count().catch(() => 0), 100);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const name = await readRoomDisplayName(row);
    if (name) out.push(name);
  }
  return out;
}

async function collectProductTitles(page) {
  const titles = page.locator(`${SELECTORS.roomBlock} ${SELECTORS.roomProductTitle}`);
  const count = Math.min(await titles.count().catch(() => 0), 100);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const title = titles.nth(index);
    if (!(await title.isVisible().catch(() => false))) continue;
    const text = compactText(await title.getAttribute("title").catch(() => "") || await title.innerText().catch(() => ""));
    if (text) out.push(text);
  }
  return out;
}

module.exports = {
  selectRooms
};
