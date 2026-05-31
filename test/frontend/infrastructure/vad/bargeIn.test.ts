import assert from "node:assert/strict";
import { test } from "node:test";
import { executeBargeIn, cancelCurrentReply, type BargeInDeps } from "../../../../frontend/infrastructure/vad/bargeIn";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recordCalls(): {
  calls: string[];
  deps: BargeInDeps;
} {
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => calls.push("cancelTts"),
    abortSse: () => calls.push("abortSse"),
    stopVad: () => calls.push("stopVad"),
    ensureAsr: () => calls.push("ensureAsr"),
  };
  return { calls, deps };
}

// ---------------------------------------------------------------------------
// executeBargeIn tests
// ---------------------------------------------------------------------------

test("executeBargeIn calls deps in deterministic order: cancelTts → abortSse → stopVad → ensureAsr", () => {
  const { calls, deps } = recordCalls();
  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "ensureAsr"]);
});

test("cancelTts throw does not block abortSse, stopVad, ensureAsr", () => {
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => { calls.push("cancelTts"); throw new Error("TTS error"); },
    abortSse: () => calls.push("abortSse"),
    stopVad: () => calls.push("stopVad"),
    ensureAsr: () => calls.push("ensureAsr"),
  };

  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "ensureAsr"]);
});

test("abortSse throw does not block stopVad and ensureAsr", () => {
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => calls.push("cancelTts"),
    abortSse: () => { calls.push("abortSse"); throw new Error("SSE error"); },
    stopVad: () => calls.push("stopVad"),
    ensureAsr: () => calls.push("ensureAsr"),
  };

  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "ensureAsr"]);
});

test("all deps throw — stopVad and ensureAsr are still attempted", () => {
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => { calls.push("cancelTts"); throw new Error("E1"); },
    abortSse: () => { calls.push("abortSse"); throw new Error("E2"); },
    stopVad: () => { calls.push("stopVad"); throw new Error("E3"); },
    ensureAsr: () => { calls.push("ensureAsr"); throw new Error("E4"); },
  };

  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "ensureAsr"]);
});

test("executeBargeIn can be called repeatedly", () => {
  const { calls, deps } = recordCalls();
  executeBargeIn(deps);
  executeBargeIn(deps);
  assert.deepStrictEqual(calls, [
    "cancelTts", "abortSse", "stopVad", "ensureAsr",
    "cancelTts", "abortSse", "stopVad", "ensureAsr",
  ]);
});

// ---------------------------------------------------------------------------
// ASR-aware behavior (caller controls whether ensureAsr starts ASR or not)
// ---------------------------------------------------------------------------

test("when ASR is already on, caller should skip ensureAsr (use cancelCurrentReply instead)", () => {
  // This test verifies the split API: cancelCurrentReply does NOT call ensureAsr
  const calls: string[] = [];
  cancelCurrentReply({
    cancelTts: () => calls.push("cancelTts"),
    abortSse: () => calls.push("abortSse"),
    stopVad: () => calls.push("stopVad"),
  });
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad"]);
});

test("when ASR is off, caller provides ensureAsr that starts ASR", () => {
  // Simulate the caller's decision: ASR is off, so ensureAsr actually starts it
  let asrStarted = false;
  const deps: BargeInDeps = {
    cancelTts: () => {},
    abortSse: () => {},
    stopVad: () => {},
    ensureAsr: () => { asrStarted = true; },
  };
  executeBargeIn(deps);
  assert.strictEqual(asrStarted, true);
});

test("when ASR is on, caller provides no-op ensureAsr to preserve transcription", () => {
  // Simulate the caller's decision: ASR is on, so ensureAsr is a no-op
  let asrStarted = false;
  const deps: BargeInDeps = {
    cancelTts: () => {},
    abortSse: () => {},
    stopVad: () => {},
    ensureAsr: () => { /* no-op: ASR already on */ },
  };
  executeBargeIn(deps);
  assert.strictEqual(asrStarted, false);
});

// ---------------------------------------------------------------------------
// cancelCurrentReply tests
// ---------------------------------------------------------------------------

test("cancelCurrentReply does not touch ASR", () => {
  const calls: string[] = [];
  cancelCurrentReply({
    cancelTts: () => calls.push("cancelTts"),
    abortSse: () => calls.push("abortSse"),
    stopVad: () => calls.push("stopVad"),
  });
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad"]);
});

test("cancelCurrentReply is resilient to throws", () => {
  const calls: string[] = [];
  cancelCurrentReply({
    cancelTts: () => { calls.push("cancelTts"); throw new Error("fail"); },
    abortSse: () => { calls.push("abortSse"); throw new Error("fail"); },
    stopVad: () => { calls.push("stopVad"); throw new Error("fail"); },
  });
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad"]);
});
