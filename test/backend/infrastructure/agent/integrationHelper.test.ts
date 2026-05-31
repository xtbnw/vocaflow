import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureTimeoutError } from "../../../integration/helper";
import type { AgentStreamEvent } from "../../../../backend/domain/agentRuntime";

test("ensureTimeoutError appends NETWORK_ERROR after silent timeout", () => {
  const events: AgentStreamEvent[] = [{ type: "thread", threadId: "thread-timeout" }];

  const result = ensureTimeoutError(events, true, 25);

  assert.deepEqual(result.at(-1), {
    type: "error",
    code: "NETWORK_ERROR",
    message: "LLM request timed out after 25ms",
  });
});

test("ensureTimeoutError preserves an existing terminal event", () => {
  const events: AgentStreamEvent[] = [{ type: "done" }];

  assert.equal(ensureTimeoutError(events, true, 25), events);
});

test("ensureTimeoutError does not append an error before timeout", () => {
  const events: AgentStreamEvent[] = [{ type: "thread", threadId: "thread-active" }];

  assert.equal(ensureTimeoutError(events, false, 25), events);
});
