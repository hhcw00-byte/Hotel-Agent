"use strict";

const { SELECTORS } = require("./selectors");
const { throwCtripError, normalizeText, compactText } = require("./mapper");

async function selectRooms(page, rooms) {
  await clickAllDayRoom(page);
  const selected = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const match = await findRoomNode(page, room.roomName);
    if (!match) {
      throwCtripError("ROOM_NOT_FOUND", "match_room", `Ctrip room not found: ${room.roomName}`);
    }
    const checkbox = match.node.locator(SELECTORS.roomCheckbox).first();
    if (!(await checkbox.count())) {
      throwCtripError("ROOM_NOT_FOUND", "match_room", `Ctrip room checkbox not found: ${room.roomName}`);
    }
    if (!(await isChecked(checkbox))) {
      await checkbox.click({ force: true });
      await page.waitForTimeout(150);
    }
    selected.push({
      roomIndex: index,
      roomName: room.roomName,
      matchedPlatformRoomName: match.displayName,
      matchStrategy: match.strategy
    });
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

async function isChecked(locator) {
  return locator.evaluate((el) => {
    const className = String(el.className || "");
    return className.includes("checked") || el.getAttribute("aria-checked") === "true";
  }).catch(() => false);
}

function stripRoomId(text) {
  return normalizeText(text).replace(/\([^)]*\)\s*$/, "").trim();
}

module.exports = {
  selectRooms
};
