import assert from "node:assert/strict";
import { test } from "node:test";
import { executeBargeIn, type BargeInDeps } from "../../../../frontend/infrastructure/vad/bargeIn";

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
    startAsr: () => calls.push("startAsr"),
  };
  return { calls, deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("executeBargeIn calls deps in deterministic order: cancelTts → abortSse → stopVad → startAsr", () => {
  const { calls, deps } = recordCalls();
  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "startAsr"]);
});

test("cancelTts throw does not block abortSse, stopVad, startAsr", () => {
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => { calls.push("cancelTts"); throw new Error("TTS error"); },
    abortSse: () => calls.push("abortSse"),
    stopVad: () => calls.push("stopVad"),
    startAsr: () => calls.push("startAsr"),
  };

  // Best-effort: must NOT throw, and all steps are called
  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "startAsr"]);
});

test("abortSse throw does not block stopVad and startAsr", () => {
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => calls.push("cancelTts"),
    abortSse: () => { calls.push("abortSse"); throw new Error("SSE error"); },
    stopVad: () => calls.push("stopVad"),
    startAsr: () => calls.push("startAsr"),
  };

  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "startAsr"]);
});

test("all deps throw — stopVad and startAsr are still attempted", () => {
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => { calls.push("cancelTts"); throw new Error("E1"); },
    abortSse: () => { calls.push("abortSse"); throw new Error("E2"); },
    stopVad: () => { calls.push("stopVad"); throw new Error("E3"); },
    startAsr: () => { calls.push("startAsr"); throw new Error("E4"); },
  };

  // Must not throw — all steps attempted
  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "startAsr"]);
});

test("executeBargeIn can be called repeatedly (idempotent from caller's perspective)", () => {
  const { calls, deps } = recordCalls();
  executeBargeIn(deps);
  executeBargeIn(deps);
  assert.deepStrictEqual(calls, [
    "cancelTts", "abortSse", "stopVad", "startAsr",
    "cancelTts", "abortSse", "stopVad", "startAsr",
  ]);
});

test("executeBargeIn with VAD stop already called (no-op stopVad) still completes sequence", () => {
  let vadRunning = true;
  const calls: string[] = [];
  const deps: BargeInDeps = {
    cancelTts: () => calls.push("cancelTts"),
    abortSse: () => calls.push("abortSse"),
    stopVad: () => {
      if (vadRunning) {
        vadRunning = false;
        calls.push("stopVad");
      }
    },
    startAsr: () => calls.push("startAsr"),
  };

  executeBargeIn(deps);
  assert.deepStrictEqual(calls, ["cancelTts", "abortSse", "stopVad", "startAsr"]);

  executeBargeIn(deps);
  assert.deepStrictEqual(calls, [
    "cancelTts", "abortSse", "stopVad", "startAsr",
    "cancelTts", "abortSse", "startAsr",
  ]);
});

test("manual barge-in via mic click follows same orchestration", () => {
  const calls1: string[] = [];
  executeBargeIn({
    cancelTts: () => calls1.push("cancelTts"),
    abortSse: () => calls1.push("abortSse"),
    stopVad: () => calls1.push("stopVad"),
    startAsr: () => calls1.push("startAsr"),
  });

  const calls2: string[] = [];
  executeBargeIn({
    cancelTts: () => calls2.push("cancelTts"),
    abortSse: () => calls2.push("abortSse"),
    stopVad: () => calls2.push("stopVad"),
    startAsr: () => calls2.push("startAsr"),
  });

  assert.deepStrictEqual(calls1, calls2);
});
