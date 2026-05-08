"use strict";

const { SELECTORS } = require("./selectors");
const {
  baseName,
  compactText,
  normalizeName,
  scoreMatch,
  throwMeituanError
} = require("./mapper");

async function selectRooms(page, rooms) {
  const selected = [];
  const roomList = Array.isArray(rooms) ? rooms : [];
  await page.waitForSelector(SELECTORS.roomBlock, { timeout: 5000 });

  for (let index = 0; index < roomList.length; index += 1) {
    const room = roomList[index] || {};
    const roomName = String(room.roomName || "").trim();
    const match = await findRoomCandidate(page, roomName);
    if (!match) {
      throwMeituanError("ROOM_NOT_FOUND", "match_room", `Meituan room not found: ${roomName}`, {
        roomName,
        visibleRoomNames: await collectRoomNames(page),
        visibleProductTitles: await collectProductTitles(page)
      });
    }

    const confirmed = await ensureRoomSelected(page, match);
    if (!confirmed) {
      throwMeituanError("ROOM_SELECTION_NOT_CONFIRMED", "match_room", `Meituan room selection was not confirmed: ${roomName}`, {
        roomName,
        matchedPlatformRoomName: match.displayName,
        visibleRoomNames: await collectRoomNames(page),
        visibleProductTitles: await collectProductTitles(page)
      });
    }

    selected.push({
      roomIndex: index,
      roomName,
      matchedPlatformRoomName: match.displayName,
      matchStrategy: match.strategy
    });
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

async function ensureRoomSelected(page, match) {
  const checkbox = match.row.locator(SELECTORS.roomProductCheckbox).first();
  const fallback = match.row.locator(SELECTORS.roomCheckbox).first();
  const targetCheckbox = (await checkbox.count().catch(() => 0)) ? checkbox : fallback;
  if (!(await targetCheckbox.count().catch(() => 0))) return false;
  if (await isRoomChecked(match.row, targetCheckbox)) return true;

  await targetCheckbox.scrollIntoViewIfNeeded().catch(() => {});
  await targetCheckbox.click({ force: true }).catch(async () => {
    const wrapper = targetCheckbox.locator("xpath=ancestor::label[contains(@class,'mtd-checkbox')][1]").first();
    if (await wrapper.isVisible().catch(() => false)) {
      await wrapper.click({ force: true }).catch(() => {});
    } else {
      await match.row.click({ force: true }).catch(() => {});
    }
  });

  await page.waitForTimeout(350);
  return isRoomChecked(match.row, targetCheckbox);
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
