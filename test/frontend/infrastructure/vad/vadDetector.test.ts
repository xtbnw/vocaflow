import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createVADState,
  evaluateVADSample,
  computeRMS,
  vadThreshold,
  VAD_ABSOLUTE_THRESHOLD,
  VAD_NOISE_FLOOR_MULTIPLIER,
  VAD_TRIGGER_SAMPLES,
  DEFAULT_VAD_CONFIG,
} from "../../../../frontend/infrastructure/vad/vadDetector";

// ---------------------------------------------------------------------------
// computeRMS
// ---------------------------------------------------------------------------

test("computeRMS — zero signal", () => {
  const buf = new Float32Array(128);
  assert.strictEqual(computeRMS(buf), 0);
});

test("computeRMS — unit amplitude", () => {
  const buf = new Float32Array(64);
  buf.fill(0.5);
  const rms = computeRMS(buf);
  assert.ok(Math.abs(rms - 0.5) < 0.0001);
});

// ---------------------------------------------------------------------------
// vadThreshold
// ---------------------------------------------------------------------------

test("vadThreshold uses absolute minimum when noise floor is low", () => {
  const t = vadThreshold(DEFAULT_VAD_CONFIG, 0.001);
  assert.strictEqual(t, VAD_ABSOLUTE_THRESHOLD); // 0.035 > 0.001 * 3
});

test("vadThreshold uses noiseFloor * multiplier when high", () => {
  const t = vadThreshold(DEFAULT_VAD_CONFIG, 0.05);
  assert.strictEqual(t, 0.05 * VAD_NOISE_FLOOR_MULTIPLIER); // 0.15
});

// ---------------------------------------------------------------------------
// evaluateVADSample — single spike does NOT trigger
// ---------------------------------------------------------------------------

test("single spike does not trigger barge-in", () => {
  const state = createVADState();
  // noiseFloor starts at 0.001 → threshold = max(0.035, 0.001*3) = 0.035
  const loud = evaluateVADSample(0.5, state);
  assert.strictEqual(loud.triggered, false);
  assert.strictEqual(loud.state.consecutiveAbove, 1);
});

// ---------------------------------------------------------------------------
// evaluateVADSample — consecutive 200ms triggers once
// ---------------------------------------------------------------------------

test("consecutive above-threshold samples trigger exactly once", () => {
  let state = createVADState();
  let triggered = false;

  // Feed 4 consecutive loud samples (VAD_TRIGGER_SAMPLES = 4)
  for (let i = 0; i < VAD_TRIGGER_SAMPLES; i++) {
    const result = evaluateVADSample(0.5, state);
    state = result.state;
    if (result.triggered) triggered = true;
  }

  assert.strictEqual(triggered, true);
  assert.strictEqual(state.triggered, true);

  // Additional loud samples should NOT trigger again
  const extra = evaluateVADSample(0.5, state);
  assert.strictEqual(extra.triggered, false);
  state = extra.state;
  assert.strictEqual(state.triggered, true);
});

// ---------------------------------------------------------------------------
// evaluateVADSample — quiet resets consecutive counter
// ---------------------------------------------------------------------------

test("quiet sample resets consecutiveAbove counter", () => {
  let state = createVADState();

  // 3 loud samples
  for (let i = 0; i < VAD_TRIGGER_SAMPLES - 1; i++) {
    state = evaluateVADSample(0.5, state).state;
  }
  assert.strictEqual(state.consecutiveAbove, VAD_TRIGGER_SAMPLES - 1);

  // 1 quiet sample resets
  state = evaluateVADSample(0.001, state).state;
  assert.strictEqual(state.consecutiveAbove, 0);

  // Need full consecutive count again
  let triggered = false;
  for (let i = 0; i < VAD_TRIGGER_SAMPLES; i++) {
    const result = evaluateVADSample(0.5, state);
    state = result.state;
    if (result.triggered) triggered = true;
  }
  assert.strictEqual(triggered, true);
});

// ---------------------------------------------------------------------------
// evaluateVADSample — noise floor adapts on quiet samples
// ---------------------------------------------------------------------------

test("noise floor increases in noisy environment", () => {
  let state = createVADState();
  const initialNoiseFloor = state.noiseFloor;

  // Feed many quiet samples at 0.01 (below 0.035 absolute threshold)
  for (let i = 0; i < 100; i++) {
    state = evaluateVADSample(0.01, state).state;
  }

  // Noise floor should have risen from 0.001 toward 0.01
  assert.ok(state.noiseFloor > initialNoiseFloor);
});

test("high noise floor raises threshold requiring louder input", () => {
  let state = createVADState();
  state.noiseFloor = 0.1; // Simulate noisy room

  // Threshold = max(0.035, 0.1 * 3) = 0.3
  // 0.2 is below 0.3 → quiet, resets consecutive
  const below = evaluateVADSample(0.2, state);
  assert.strictEqual(below.triggered, false);
  assert.strictEqual(below.state.consecutiveAbove, 0);

  // 0.4 is above 0.3 → counts toward trigger
  state = below.state;
  const above = evaluateVADSample(0.4, state);
  assert.strictEqual(above.state.consecutiveAbove, 1);
});

// ---------------------------------------------------------------------------
// createVADState reset
// ---------------------------------------------------------------------------

test("createVADState produces fresh state with no trigger", () => {
  let state = createVADState();

  // Feed enough to trigger
  for (let i = 0; i < VAD_TRIGGER_SAMPLES; i++) {
    state = evaluateVADSample(0.5, state).state;
  }
  assert.strictEqual(state.triggered, true);

  // Fresh state
  const fresh = createVADState();
  assert.strictEqual(fresh.triggered, false);
  assert.strictEqual(fresh.consecutiveAbove, 0);
});
