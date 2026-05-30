import assert from "node:assert/strict";
import { test } from "node:test";
import { isInRange, isOnLocalDate, toTimestamp } from "../../../backend/shared/timeUtils";

test("isInRange handles mixed Z and +08:00 timezones", () => {
  // Event in UTC (Z)
  const eventStart = "2026-05-30T02:00:00Z";  // 10:00 AM Beijing
  const eventEnd = "2026-05-30T03:00:00Z";     // 11:00 AM Beijing

  // Query range in +08:00
  const rangeStart = "2026-05-30T09:00:00+08:00";  // 01:00 UTC
  const rangeEnd = "2026-05-30T11:00:00+08:00";     // 03:00 UTC

  // Event (02:00-03:00 UTC) overlaps with range (01:00-03:00 UTC) — yes
  assert.equal(isInRange(eventStart, eventEnd, rangeStart, rangeEnd), true);
});

test("isInRange excludes event before range with mixed timezones", () => {
  // Event at 08:00 Beijing (00:00 UTC)
  const eventStart = "2026-05-30T00:00:00Z";
  const eventEnd = "2026-05-30T01:00:00Z";
  // Range 09:00-11:00 Beijing (01:00-03:00 UTC)
  const rangeStart = "2026-05-30T09:00:00+08:00";
  const rangeEnd = "2026-05-30T11:00:00+08:00";

  assert.equal(isInRange(eventStart, eventEnd, rangeStart, rangeEnd), false);
});

test("isInRange includes event after range with mixed timezones", () => {
  // Event at 12:00 Beijing (04:00 UTC)
  const eventStart = "2026-05-30T04:00:00Z";
  const eventEnd = "2026-05-30T05:00:00Z";
  // Range 09:00-11:00 Beijing (01:00-03:00 UTC)
  const rangeStart = "2026-05-30T09:00:00+08:00";
  const rangeEnd = "2026-05-30T11:00:00+08:00";

  assert.equal(isInRange(eventStart, eventEnd, rangeStart, rangeEnd), false);
});

test("isInRange handles same timezone Z", () => {
  const eventStart = "2026-05-30T10:00:00Z";
  const eventEnd = "2026-05-30T11:00:00Z";
  const rangeStart = "2026-05-30T09:00:00Z";
  const rangeEnd = "2026-05-30T12:00:00Z";

  assert.equal(isInRange(eventStart, eventEnd, rangeStart, rangeEnd), true);
});

test("isInRange handles same timezone +08:00", () => {
  const eventStart = "2026-05-30T10:00:00+08:00";
  const eventEnd = "2026-05-30T11:00:00+08:00";
  const rangeStart = "2026-05-30T09:00:00+08:00";
  const rangeEnd = "2026-05-30T12:00:00+08:00";

  assert.equal(isInRange(eventStart, eventEnd, rangeStart, rangeEnd), true);
});

test("isInRange event equals range boundaries — touching but not overlapping", () => {
  const eventStart = "2026-05-30T09:00:00Z";
  const eventEnd = "2026-05-30T10:00:00Z";
  const rangeStart = "2026-05-30T10:00:00Z";
  const rangeEnd = "2026-05-30T11:00:00Z";

  assert.equal(isInRange(eventStart, eventEnd, rangeStart, rangeEnd), false);
});

test("isOnLocalDate does not depend on ISO string prefix", () => {
  // This ISO string has "2026-05-29" in UTC but is May 30 in +08:00
  const isoTZ = "2026-05-29T16:00:00-08:00"; // Equivalent to May 30 08:00 in +08:00
  const dateKey = "2026-05-30";

  // The date should be determined by local time, not the ISO prefix
  assert.equal(isOnLocalDate(isoTZ, dateKey), true);
});

test("isOnLocalDate matches correct date", () => {
  const iso = "2026-05-30T10:00:00+08:00";
  assert.equal(isOnLocalDate(iso, "2026-05-30"), true);
  assert.equal(isOnLocalDate(iso, "2026-05-29"), false);
});

test("isOnLocalDate midnight boundary", () => {
  // 2026-05-30T00:00:00+08:00 should be May 30
  const iso = "2026-05-29T16:00:00Z"; // Midnight in +08:00
  assert.equal(isOnLocalDate(iso, "2026-05-30"), true);
  assert.equal(isOnLocalDate(iso, "2026-05-29"), false);
});

test("isOnLocalDate late night", () => {
  // 2026-05-30T23:59:00+08:00 should be May 30
  const iso = "2026-05-30T15:59:00Z"; // 23:59 in +08:00
  assert.equal(isOnLocalDate(iso, "2026-05-30"), true);
  assert.equal(isOnLocalDate(iso, "2026-05-31"), false);
});

test("toTimestamp converts correctly", () => {
  const zTime = "2026-05-30T00:00:00Z";
  const plus8Time = "2026-05-30T08:00:00+08:00";
  assert.equal(toTimestamp(zTime), toTimestamp(plus8Time));
});
