"use strict";

const { SELECTORS, ALL_DAY_ROOM_TEXTS } = require("./selectors");
const { throwTripError, normalizeText, compactText } = require("./mapper");

async function selectRooms(page, rooms) {
  await clickAllDayRoom(page);
  const selected = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const match = await findRoomNode(page, room.roomName);
    if (!match) {
      throwTripError("ROOM_NOT_FOUND", "match_room", `Trip room not found: ${room.roomName}`);
    }
    const checkbox = match.node.locator(SELECTORS.roomCheckbox).first();
    if (!(await checkbox.count())) {
      throwTripError("ROOM_NOT_FOUND", "match_room", `Trip room checkbox not found: ${room.roomName}`);
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

async function isChecked(locator) {
  return locator.evaluate((el) => {
    const className = String(el.className || "");
    const parentClass = String(el.parentElement && el.parentElement.className || "");
    return className.includes("checked")
      || parentClass.includes("checked")
      || el.getAttribute("aria-checked") === "true"
      || el.checked === true;
  }).catch(() => false);
}

function stripRoomId(text) {
  return normalizeText(text).replace(/\([^)]*\)\s*$/, "").trim();
}

module.exports = {
  selectRooms
};
