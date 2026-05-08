"use strict";

const SUPPORTED_PLATFORMS = new Set(["ctrip", "trip", "meituan", "booking"]);
const ALLOWED_TOP_LEVEL_FIELDS = new Set(["platformCode", "segments", "startDate", "endDate", "roomList", "runtime"]);

function normalizeInput(input) {
  if (!isPlainObject(input)) {
    throwInputError("INVALID_INPUT", "input_normalize", "Input must be an object.");
  }
  validateAllowedTopLevelFields(input);

  const platformCode = pickString(input.platformCode).toLowerCase();
  if (!platformCode) {
    throwInputError("INVALID_INPUT", "input_normalize", "platformCode is required.");
  }
  if (!SUPPORTED_PLATFORMS.has(platformCode)) {
    throwInputError("UNSUPPORTED_PLATFORM", "platform_routing", `Unsupported platformCode: ${platformCode}`);
  }

  const segments = normalizeSegmentsInput(input);

  return {
    platformCode,
    segments,
    runtime: isPlainObject(input.runtime) ? { ...input.runtime } : {},
    rawInput: input
  };
}

function validateAllowedTopLevelFields(input) {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      throwInputError("INVALID_INPUT", "input_normalize", `Unsupported V2 field: ${key}.`);
    }
  }
}

function normalizeSegmentsInput(input) {
  if (Array.isArray(input.segments)) {
    return normalizeSegments(input.segments);
  }
  return normalizeSegments([{
    startDate: input.startDate,
    endDate: input.endDate,
    roomList: input.roomList
  }]);
}

function normalizeSegments(segmentsInput) {
  if (segmentsInput.length < 1) {
    throwInputError("EMPTY_SEGMENTS", "input_normalize", "segments must be a non-empty array.");
  }
  return segmentsInput.map((segment, index) => {
    if (!isPlainObject(segment)) {
      throwInputError("INVALID_SEGMENT", "input_normalize", `segments[${index}] must be an object.`);
    }
    const startDate = pickString(segment.startDate);
    const endDate = pickString(segment.endDate);
    const roomList = segment.roomList;
    validateSegmentFields({ startDate, endDate, roomList }, index);
    return {
      segmentIndex: index,
      startDate,
      endDate,
      roomList: cloneRoomList(roomList)
    };
  });
}

function validateSegmentFields(segment, index) {
  if (!isIsoDate(segment.startDate) || !isIsoDate(segment.endDate) || segment.startDate > segment.endDate) {
    throwInputError("INVALID_DATE_RANGE", "input_normalize", `segments[${index}] startDate/endDate is invalid.`);
  }
  if (!Array.isArray(segment.roomList)) {
    throwInputError("EMPTY_ROOM_LIST", "input_normalize", `segments[${index}].roomList must be an array.`);
  }
  if (segment.roomList.length < 1) {
    throwInputError("EMPTY_ROOM_LIST", "input_normalize", `segments[${index}].roomList must not be empty.`);
  }
  segment.roomList.forEach((room, roomIndex) => {
    if (!isPlainObject(room)) {
      throwInputError("INVALID_ROOM", "input_normalize", `segments[${index}].roomList[${roomIndex}] must be an object.`);
    }
    if (!pickString(room.roomName)) {
      throwInputError("INVALID_ROOM_NAME", "input_normalize", `segments[${index}].roomList[${roomIndex}].roomName is required.`);
    }
    if (!isValidPrice(room.price)) {
      throwInputError("INVALID_PRICE", "input_normalize", `segments[${index}].roomList[${roomIndex}].price must be a positive numeric string.`);
    }
  });
}

function cloneRoomList(roomList) {
  return roomList.map((room) => ({
    roomName: pickString(room.roomName),
    price: pickString(room.price)
  }));
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidPrice(value) {
  const text = pickString(value);
  if (!/^\d+(\.\d+)?$/.test(text)) return false;
  const number = Number(text);
  return Number.isFinite(number) && number > 0;
}

function pickString(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwInputError(code, stage, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  throw error;
}

module.exports = {
  normalizeInput,
  isPlainObject,
  pickString
};
