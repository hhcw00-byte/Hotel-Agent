"use strict";

const fs = require("fs");
const { requirePlaywright } = require("../shared/require-playwright");
const { SELECTORS } = require("./selectors");
const {
  normalizeText,
  normalizePrice,
  isVisible,
  findFirstVisible,
  setInputValue,
  readInputValue,
  getPanelFromInput,
  openPriceSection,
  getPriceFormSubmitButton,
  clickEnabledPriceSubmit,
  waitForSuccessStatus,
  closePanel
} = require("./dom-utils");

const DEFAULT_PRICE_PAGE_URL = "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html";
const DEFAULT_TIMEOUT_MS = 30000;
const FAILURE_CODES = new Set([
  "PAGE_NOT_READY",
  "ROOM_NOT_FOUND",
  "OPEN_BULK_EDIT_FAILED",
  "DATE_INPUT_NOT_FOUND",
  "DATE_SET_FAILED",
  "PRICE_SECTION_NOT_FOUND",
  "PRICE_INPUT_NOT_FOUND",
  "PRICE_SET_FAILED",
  "SUBMIT_BUTTON_DISABLED",
  "SAVE_SUCCESS_NOT_DETECTED"
]);

async function runBookingV2(input, options = {}) {
  const mode = normalizeMode(options.mode);
  const task = normalizeInput(input);
  const roomResults = [];
  let session = null;

  try {
    session = await createBrowserSession(task.runtime);
    const page = session.page;
    page.setDefaultTimeout(task.runtime.timeoutMs);

    await openCalendarPage(page, task.runtime);

    for (const room of task.roomList) {
      const result = await processRoom(page, room, task, mode);
      roomResults.push(result);
    }

    return buildSuccess(task, mode, roomResults, page);
  } catch (error) {
    return buildFailure(task, mode, roomResults, error, session && session.page);
  } finally {
    await cleanupSession(session);
  }
}

async function processRoom(page, room, task, mode) {
  const state = { roomName: room.roomName, matchedRoomTitle: "" };
  let panel = null;
  try {
    logStage("MATCH_ROOM", state);
    const matched = await findRoomBlock(page, room.roomName);
    state.matchedRoomTitle = matched.matchedRoomTitle;

    logStage("OPEN_BULK_EDIT", state);
    await openRoomBulkEdit(matched.roomBlock, task.runtime.timeoutMs);

    logStage("DATE_INPUT_CHECK", state);
    const dateFrom = await waitForDateInput(page, SELECTORS.dateFrom, task.runtime.timeoutMs);
    panel = await getPanelFromInput(page, dateFrom);
    const dateUntil = await findFirstVisible(panel, SELECTORS.dateUntil, 1000);
    if (!dateUntil) throwBookingError("DATE_INPUT_NOT_FOUND", "Booking V2 date-until input was not found.", state);

    logStage("PRICE_SECTION_CHECK", state);
    const priceInput = await openPriceSection(panel, task.runtime.timeoutMs);

    if (mode === "inspect") {
      await closePanel(page, panel);
      return buildRoomResult(room, state, {
        submitted: false,
        inspectOnly: true,
        priceInputId: await priceInput.getAttribute("id").catch(() => "")
      });
    }

    logStage("SET_DATES", state);
    try {
      await setInputValue(dateFrom, task.startDate, { blur: true, timeoutMs: task.runtime.timeoutMs });
      await setInputValue(dateUntil, task.endDate, { blur: true, timeoutMs: task.runtime.timeoutMs });
    } catch (error) {
      throwBookingError("DATE_SET_FAILED", `Booking V2 date fill failed: ${error.message || String(error)}`, state);
    }
    await assertDateValues(dateFrom, dateUntil, task, state);

    logStage("SET_PRICE", state);
    try {
      await setInputValue(priceInput, room.price, { blur: false, timeoutMs: task.runtime.timeoutMs });
    } catch (error) {
      throwBookingError("PRICE_SET_FAILED", `Booking V2 price fill failed: ${error.message || String(error)}`, state);
    }
    await assertPriceValue(priceInput, room.price, state);

    logStage("PRE_SUBMIT_CHECK", state);
    await assertSubmitReady(panel, state);

    logStage("SUBMIT", state);
    try {
      await clickEnabledPriceSubmit(panel, task.runtime.timeoutMs);
    } catch (error) {
      throwBookingError("SUBMIT_BUTTON_DISABLED", `Booking V2 submit click failed: ${error.message || String(error)}`, state);
    }

    logStage("WAIT_SAVE_SUCCESS", state);
    const saveStatus = await waitForSuccessStatus(page, Math.min(task.runtime.timeoutMs, 15000));
    await closePanel(page, panel);

    return buildRoomResult(room, state, {
      submitted: true,
      successText: saveStatus.text
    });
  } catch (error) {
    if (panel) await closePanel(page, panel).catch(() => {});
    throw normalizeBookingError(error, state);
  }
}

async function openCalendarPage(page, runtime) {
  try {
    await page.goto(runtime.pricePageUrl, {
      waitUntil: "domcontentloaded",
      timeout: runtime.timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: Math.min(runtime.timeoutMs, 10000) }).catch(() => {});
    await page.locator(SELECTORS.room).first().waitFor({
      state: "visible",
      timeout: runtime.timeoutMs
    });
  } catch (error) {
    throwBookingError("PAGE_NOT_READY", `Booking calendar page was not ready: ${error.message || String(error)}`);
  }
}

async function findRoomBlock(page, roomName) {
  const requested = normalizeText(roomName);
  const rooms = page.locator(SELECTORS.room);
  const count = await rooms.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const roomBlock = rooms.nth(index);
    const titleLocator = roomBlock.locator(SELECTORS.roomTitle).first();
    const matchedRoomTitle = normalizeText(await titleLocator.innerText({ timeout: 1000 }).catch(() => ""));
    if (matchedRoomTitle && matchedRoomTitle.includes(requested)) {
      return { roomBlock, matchedRoomTitle };
    }
  }
  throwBookingError("ROOM_NOT_FOUND", `Booking room was not found by roomName: ${roomName}`);
}

async function openRoomBulkEdit(roomBlock, timeoutMs) {
  const button = roomBlock.locator(SELECTORS.roomBulkEditButton).first();
  if (!await isVisible(button, 1000)) {
    throwBookingError("OPEN_BULK_EDIT_FAILED", "Booking room-level Bulk edit button was not found.");
  }
  try {
    await button.click({ timeout: Math.min(timeoutMs || 5000, 5000) });
  } catch (error) {
    throwBookingError("OPEN_BULK_EDIT_FAILED", `Booking room-level Bulk edit click failed: ${error.message || String(error)}`);
  }
}

async function waitForDateInput(page, selectors, timeoutMs) {
  const deadline = Date.now() + Math.max(1000, timeoutMs || 5000);
  while (Date.now() < deadline) {
    const input = await findFirstVisible(page, selectors, 300);
    if (input) return input;
    await page.waitForTimeout(200).catch(() => {});
  }
  throwBookingError("DATE_INPUT_NOT_FOUND", "Booking V2 date-from input was not found.");
}

async function assertDateValues(dateFrom, dateUntil, task, state) {
  const actualStart = await readInputValue(dateFrom);
  const actualEnd = await readInputValue(dateUntil);
  if (actualStart !== task.startDate || actualEnd !== task.endDate) {
    throwBookingError("DATE_SET_FAILED", "Booking V2 date input readback did not match.", {
      ...state,
      expectedStartDate: task.startDate,
      actualStartDate: actualStart,
      expectedEndDate: task.endDate,
      actualEndDate: actualEnd
    });
  }
}

async function assertPriceValue(priceInput, expectedPrice, state) {
  const actualPrice = await readInputValue(priceInput);
  if (normalizePrice(actualPrice) !== normalizePrice(expectedPrice)) {
    throwBookingError("PRICE_SET_FAILED", "Booking V2 price input readback did not match.", {
      ...state,
      expectedPrice: normalizePrice(expectedPrice),
      actualPrice: normalizePrice(actualPrice)
    });
  }
}

async function assertSubmitReady(panel, state) {
  const submit = await getPriceFormSubmitButton(panel);
  if (!submit || !await submit.count().catch(() => 0) || !await submit.isEnabled().catch(() => false)) {
    throwBookingError("SUBMIT_BUTTON_DISABLED", "Booking V2 price form submit button was missing or disabled.", state);
  }
}

async function createBrowserSession(runtime) {
  const chromium = requirePlaywright().chromium;
  if (runtime.cdpEndpoint) {
    try {
      const browser = await chromium.connectOverCDP(runtime.cdpEndpoint);
      const contexts = browser.contexts();
      const context = contexts[0];
      if (!context) throwBookingError("PAGE_NOT_READY", "CDP connected but no browser context was found.");
      const page = context.pages().find((item) => !item.isClosed()) || await context.newPage();
      return { browser, context, page, disconnectBrowser: true };
    } catch (error) {
      if (FAILURE_CODES.has(error.code)) throw error;
      throwBookingError("PAGE_NOT_READY", `Booking V2 CDP connect failed: ${error.message || String(error)}`);
    }
  }

  if (!runtime.userDataDir) {
    throwBookingError("PAGE_NOT_READY", "runtime.userDataDir is required when runtime.cdpEndpoint is not provided.");
  }
  if (!fs.existsSync(runtime.userDataDir)) {
    fs.mkdirSync(runtime.userDataDir, { recursive: true });
  }
  try {
    const context = await chromium.launchPersistentContext(runtime.userDataDir, {
      headless: false,
      channel: runtime.browserChannel,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    const page = context.pages().find((item) => !item.isClosed()) || await context.newPage();
    return { context, page, closeContext: true };
  } catch (error) {
    throwBookingError("PAGE_NOT_READY", `Booking V2 browser launch failed: ${error.message || String(error)}`);
  }
}

async function cleanupSession(session) {
  if (!session) return;
  if (session.disconnectBrowser && session.browser && typeof session.browser.disconnect === "function") {
    await session.browser.disconnect().catch(() => {});
    return;
  }
  if (session.closeContext && session.context) {
    await session.context.close().catch(() => {});
  }
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throwBookingError("PAGE_NOT_READY", "Booking V2 input must be an object.");
  }
  const platformCode = String(input.platformCode || "").trim().toLowerCase();
  if (platformCode !== "booking") {
    throwBookingError("PAGE_NOT_READY", "Booking V2 only supports platformCode=booking.");
  }
  const startDate = String(input.startDate || "").trim();
  const endDate = String(input.endDate || "").trim();
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throwBookingError("DATE_SET_FAILED", "Booking V2 startDate/endDate must be YYYY-MM-DD and startDate <= endDate.");
  }
  if (!Array.isArray(input.roomList) || input.roomList.length < 1) {
    throwBookingError("ROOM_NOT_FOUND", "Booking V2 roomList must be a non-empty array.");
  }
  const roomList = input.roomList.map((room, index) => normalizeRoom(room, index));
  return {
    platformCode,
    startDate,
    endDate,
    roomList,
    runtime: normalizeRuntime(input.runtime || {})
  };
}

function normalizeRoom(room, index) {
  const roomName = String(room && room.roomName || "").trim();
  const price = String(room && room.price || "").trim();
  if (!roomName) throwBookingError("ROOM_NOT_FOUND", `roomList[${index}].roomName is required.`);
  if (!price) throwBookingError("PRICE_SET_FAILED", `roomList[${index}].price is required.`);
  return { roomName, price };
}

function normalizeRuntime(runtime) {
  const timeoutMs = Number(runtime.timeoutMs || DEFAULT_TIMEOUT_MS);
  return {
    browserChannel: String(runtime.browserChannel || "chrome").trim(),
    userDataDir: String(runtime.userDataDir || "").trim(),
    cdpEndpoint: String(runtime.cdpEndpoint || "").trim(),
    pricePageUrl: String(runtime.pricePageUrl || DEFAULT_PRICE_PAGE_URL).trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(Math.floor(timeoutMs), 60000) : DEFAULT_TIMEOUT_MS
  };
}

function normalizeMode(mode) {
  const value = String(mode || "inspect").trim().toLowerCase();
  return value === "live" ? "live" : "inspect";
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function throwBookingError(code, message, diagnostics = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.stage = code;
  error.diagnostics = diagnostics;
  throw error;
}

function normalizeBookingError(error, state = {}) {
  const rawCode = error && error.code ? String(error.code) : "";
  const code = FAILURE_CODES.has(rawCode) ? rawCode : "PAGE_NOT_READY";
  const normalized = new Error(error && error.message ? error.message : String(error || code));
  normalized.code = code;
  normalized.stage = FAILURE_CODES.has(error && error.stage) ? error.stage : code;
  normalized.diagnostics = {
    ...state,
    ...(error && error.diagnostics && typeof error.diagnostics === "object" ? error.diagnostics : {})
  };
  return normalized;
}

function buildRoomResult(room, state, details = {}) {
  return {
    ok: true,
    success: true,
    submitted: Boolean(details.submitted),
    inspectOnly: Boolean(details.inspectOnly),
    roomName: room.roomName,
    price: room.price,
    matchedRoomTitle: state.matchedRoomTitle,
    priceInputId: details.priceInputId || "price-input-0",
    successText: details.successText || ""
  };
}

function buildSuccess(task, mode, roomResults, page) {
  const submittedRooms = roomResults.filter((item) => item.submitted).length;
  return {
    ok: true,
    success: true,
    platformCode: "booking",
    mode,
    submitted: mode === "live" && submittedRooms === task.roomList.length,
    summary: {
      totalRooms: task.roomList.length,
      successRooms: roomResults.length,
      failedRooms: 0,
      submittedRooms
    },
    roomResults,
    diagnostics: {
      executionPlanMode: "booking_v2_room_bulk_edit",
      pricePageUrl: task.runtime.pricePageUrl,
      finalPageUrl: page ? safePageUrl(page) : ""
    }
  };
}

function buildFailure(task, mode, roomResults, error, page) {
  const failure = normalizeBookingError(error);
  return {
    ok: false,
    success: false,
    platformCode: "booking",
    mode,
    submitted: false,
    summary: {
      totalRooms: task && task.roomList ? task.roomList.length : 0,
      successRooms: roomResults.length,
      failedRooms: Math.max(1, (task && task.roomList ? task.roomList.length : 1) - roomResults.length),
      submittedRooms: roomResults.filter((item) => item.submitted).length
    },
    roomResults,
    failure: {
      code: failure.code,
      stage: failure.stage,
      message: failure.message,
      diagnostics: failure.diagnostics || {}
    },
    failureReasonCode: failure.code,
    failedStep: failure.stage,
    diagnostics: {
      executionPlanMode: "booking_v2_room_bulk_edit",
      pricePageUrl: task && task.runtime ? task.runtime.pricePageUrl : "",
      finalPageUrl: page ? safePageUrl(page) : ""
    }
  };
}

function safePageUrl(page) {
  try {
    return page.url();
  } catch (_) {
    return "";
  }
}

function logStage(stage, state) {
  process.stderr.write(`[booking-v2] stage=${stage} roomName=${JSON.stringify(state.roomName || "")} matchedRoomTitle=${JSON.stringify(state.matchedRoomTitle || "")}\n`);
}

module.exports = {
  runBookingV2
};
