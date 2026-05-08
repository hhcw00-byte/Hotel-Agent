"use strict";

const { selectors } = require("./selectors");
const { isVisible, safeText, throwBookingError } = require("./mapper");
const { safePageUrl } = require("./runtime");

async function closeAnyBulkEditPanel(page) {
  const panel = await detectBulkEditPanel(page);
  if (!panel) return { closed: true, wasOpen: false };

  const closeButton = await firstVisible(panel, [
    "button[aria-label*=\"Close\" i]",
    "button[aria-label*=\"Cancel\" i]",
    "button:has-text(\"Cancel\")",
    "button:has-text(\"\u53d6\u6d88\")",
    "button:has-text(\"\u5173\u95ed\")"
  ]);
  if (closeButton) await closeButton.click({ timeout: 2000 }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!await detectBulkEditPanel(page)) return { closed: true, wasOpen: true };
    await page.waitForTimeout(150);
  }
  return { closed: false, wasOpen: true };
}

async function openBulkEditForRoom(page, roomName, options = {}) {
  const requestedRoomName = String(roomName || "").trim();
  if (!requestedRoomName) {
    throwBookingError("ROOM_NOT_FOUND", "open_bulk_edit", "Booking roomName is required.", await bulkEditDiagnostics(page, {
      segmentIndex: options.segmentIndex,
      requestedRoomName,
      failedStep: "room_name_empty"
    }));
  }

  const roomMatch = await findRoomBlock(page, requestedRoomName, options);
  const button = roomMatch.row.locator("button[data-test-id=\"general-modal-cta\"]").first();
  if (!await isVisible(button)) {
    throwBookingError("BULK_EDIT_BUTTON_NOT_FOUND", "open_bulk_edit", `Booking bulk edit button was not found for room: ${requestedRoomName}`, await bulkEditDiagnostics(page, {
      ...roomMatch.diagnostics,
      failedStep: "bulk_edit_button_not_found"
    }));
  }

  await roomMatch.row.scrollIntoViewIfNeeded().catch(() => {});
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click({ timeout: 3000 });

  const panel = await waitForBulkEditPanel(page, options.timeoutMs || 8000);
  if (!panel) {
    throwBookingError("BULK_EDIT_PANEL_NOT_OPEN", "open_bulk_edit", `Booking Bulk edit panel did not open for room: ${requestedRoomName}`, await bulkEditDiagnostics(page, {
      ...roomMatch.diagnostics,
      bulkEditClicked: true,
      failedStep: "bulk_edit_panel_not_open"
    }));
  }

  return {
    panel,
    matchedRoomName: roomMatch.matchedRoomName,
    diagnostics: {
      ...roomMatch.diagnostics,
      bulkEditButtonFound: true,
      bulkEditClicked: true,
      bulkEditPanelOpened: true,
      failedStep: ""
    }
  };
}

async function findRoomBlock(page, requestedRoomName, options = {}) {
  const candidates = await collectRoomCandidates(page);
  const match = matchRoomCandidates(candidates, requestedRoomName);
  const base = {
    segmentIndex: options.segmentIndex,
    requestedRoomName,
    roomBlockCount: candidates.length,
    roomBlockTestIds: candidates.map((item) => item.testId),
    roomTitleTexts: candidates.map((item) => item.title),
    roomCandidates: candidates.map(toRoomCandidateDiagnostic),
    currentUrl: safePageUrl(page),
    bodyTextSample: await bodyTextSample(page)
  };

  if (match.status === "not_found") {
    throwBookingError("ROOM_NOT_FOUND", "open_bulk_edit", `Booking room was not found: ${requestedRoomName}`, {
      ...base,
      failedStep: "room_not_found"
    });
  }
  if (match.status === "ambiguous") {
    throwBookingError("ROOM_NAME_AMBIGUOUS", "open_bulk_edit", `Booking room name is ambiguous: ${requestedRoomName}`, {
      ...base,
      ambiguousMatches: match.items.map(toRoomCandidateDiagnostic),
      failedStep: "room_name_ambiguous"
    });
  }

  return {
    row: match.item.row,
    matchedRoomName: match.item.normalizedTitle || match.item.title,
    diagnostics: {
      ...base,
      matchedRoomName: match.item.normalizedTitle || match.item.title,
      selectedRoomBlockTestId: match.item.testId,
      roomRowFound: true
    }
  };
}

async function collectRoomCandidates(page) {
  const blocks = page.locator(".av-cal-list-room[data-test-id^=\"room-\"]");
  const count = await blocks.count().catch(() => 0);
  const candidates = [];
  for (let index = 0; index < Math.min(count, 200); index += 1) {
    const row = blocks.nth(index);
    if (!await isVisible(row)) continue;
    const title = await readRoomTitle(row);
    candidates.push({
      row,
      index,
      testId: await row.getAttribute("data-test-id").catch(() => ""),
      title,
      normalizedTitle: normalizeBookingRoomName(title)
    });
  }
  return candidates;
}

async function readRoomTitle(row) {
  for (const selector of selectors.roomTitle || []) {
    const locator = row.locator(selector).first();
    if (await isVisible(locator)) {
      const text = String(await safeText(locator)).replace(/\s+/g, " ").trim();
      if (text) return text;
    }
  }
  return String(await safeText(row)).replace(/\s+/g, " ").trim();
}

function matchRoomCandidates(candidates, requestedRoomName) {
  const requested = compactRoomName(requestedRoomName);
  const exact = candidates.filter((item) => compactRoomName(item.normalizedTitle || item.title) === requested);
  if (exact.length === 1) return { status: "matched", item: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", items: exact };

  const contained = candidates.filter((item) => compactRoomName(item.normalizedTitle || item.title).includes(requested));
  if (contained.length === 1) return { status: "matched", item: contained[0] };
  if (contained.length > 1) return { status: "ambiguous", items: contained };

  return { status: "not_found" };
}

async function waitForBulkEditPanel(page, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs || 8000, 12000);
  while (Date.now() < deadline) {
    const panel = await detectBulkEditPanel(page);
    if (panel) return panel;
    await page.waitForTimeout(150);
  }
  return null;
}

async function detectBulkEditPanel(page) {
  for (const panelSelector of selectors.bulkEditPanel || []) {
    const panels = page.locator(panelSelector);
    const count = await panels.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const panel = panels.nth(index);
      if (!await isVisible(panel)) continue;
      if (await hasBulkEditMarker(panel)) return panel;
    }
  }
  return await hasBulkEditMarker(page) ? page.locator("body").first() : null;
}

async function hasBulkEditMarker(scope) {
  for (const selector of selectors.bulkEditOpenMarkers || []) {
    if (await isVisible(scope.locator(selector).first())) return true;
  }
  return false;
}

async function firstVisible(scope, selectorList) {
  for (const selector of selectorList || []) {
    const locator = scope.locator(selector).first();
    if (await isVisible(locator)) return locator;
  }
  return null;
}

async function bulkEditDiagnostics(page, extra = {}) {
  const candidates = await collectRoomCandidates(page).catch(() => []);
  return {
    platformCode: "booking",
    segmentIndex: extra.segmentIndex,
    requestedRoomName: extra.requestedRoomName || "",
    matchedRoomName: extra.matchedRoomName || "",
    selectedRoomBlockTestId: extra.selectedRoomBlockTestId || "",
    roomBlockCount: candidates.length,
    roomBlockTestIds: candidates.map((item) => item.testId),
    roomTitleTexts: candidates.map((item) => item.title),
    roomCandidates: candidates.map(toRoomCandidateDiagnostic),
    roomRowFound: Boolean(extra.roomRowFound),
    bulkEditButtonFound: Boolean(extra.bulkEditButtonFound),
    bulkEditClicked: Boolean(extra.bulkEditClicked),
    bulkEditPanelOpened: Boolean(extra.bulkEditPanelOpened),
    bulkEditMarkersVisible: await collectVisibleBulkEditMarkers(page),
    currentUrl: safePageUrl(page),
    bodyTextSample: await bodyTextSample(page),
    failedStep: extra.failedStep || ""
  };
}

async function collectVisibleBulkEditMarkers(page) {
  const out = [];
  for (const selector of selectors.bulkEditOpenMarkers || []) {
    if (await isVisible(page.locator(selector).first())) out.push(selector);
    if (out.length >= 10) break;
  }
  return out;
}

function toRoomCandidateDiagnostic(item) {
  return {
    index: item.index,
    testId: item.testId,
    title: item.title,
    normalizedTitle: item.normalizedTitle
  };
}

async function bodyTextSample(page) {
  return String(await safeText(page.locator("body").first()).catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizeBookingRoomName(value) {
  return String(value || "")
    .replace(/[（(]\s*(?:客房\s*ID|房间\s*ID|Room\s*ID|ID)\s*[:：#]?\s*[^）)]*[）)]/ig, "")
    .replace(/\s*(?:客房\s*ID|房间\s*ID|Room\s*ID|ID)\s*[:：#]?\s*\d+\s*/ig, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactRoomName(value) {
  return normalizeBookingRoomName(value).replace(/\s+/g, "").toLowerCase();
}

module.exports = {
  closeAnyBulkEditPanel,
  openBulkEditForRoom,
  findRoomBlock,
  detectBulkEditPanel,
  normalizeBookingRoomName,
  compactRoomName
};
