import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldApplyCalendarEventsResponse } from "../../../frontend/hooks/useCalendarEvents";

test("calendar refresh applies the latest response", () => {
  assert.equal(shouldApplyCalendarEventsResponse(2, 2), true);
});

test("calendar refresh ignores a stale response", () => {
  assert.equal(shouldApplyCalendarEventsResponse(1, 2), false);
});
