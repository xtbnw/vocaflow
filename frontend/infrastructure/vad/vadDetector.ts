// Lightweight VAD pure logic — no DOM / Web Audio dependencies.
// All parameters are named constants so they can be tuned without
// touching the decision code.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VAD_SAMPLE_INTERVAL_MS = 50;
export const VAD_TRIGGER_DURATION_MS = 200;
export const VAD_ABSOLUTE_THRESHOLD = 0.035;
export const VAD_NOISE_FLOOR_MULTIPLIER = 3;

/** Number of consecutive above-threshold samples required to trigger. */
export const VAD_TRIGGER_SAMPLES = Math.ceil(VAD_TRIGGER_DURATION_MS / VAD_SAMPLE_INTERVAL_MS); // 4

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VADConfig {
  readonly absoluteThreshold: number;
  readonly noiseFloorMultiplier: number;
  readonly triggerSamples: number;
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  absoluteThreshold: VAD_ABSOLUTE_THRESHOLD,
  noiseFloorMultiplier: VAD_NOISE_FLOOR_MULTIPLIER,
  triggerSamples: VAD_TRIGGER_SAMPLES,
};

export interface VADState {
  /** Exponentially-weighted moving average of ambient noise RMS. */
  noiseFloor: number;
  /** Number of consecutive samples currently above the trigger threshold. */
  consecutiveAbove: number;
  /** Whether the VAD has already triggered for the current active period. */
  triggered: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createVADState(): VADState {
  return {
    noiseFloor: 0.001,
    consecutiveAbove: 0,
    triggered: false,
  };
}

// ---------------------------------------------------------------------------
// RMS computation
// ---------------------------------------------------------------------------

/** Compute RMS from time-domain Float32 PCM samples (range -1..1). */
export function computeRMS(samples: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i];
  }
  return Math.sqrt(sumSquares / samples.length);
}

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

/** Compute the VAD threshold given the current noise floor estimate. */
export function vadThreshold(config: VADConfig, noiseFloor: number): number {
  return Math.max(config.absoluteThreshold, noiseFloor * config.noiseFloorMultiplier);
}

// ---------------------------------------------------------------------------
// Core decision
// ---------------------------------------------------------------------------

export interface VADEvaluateResult {
  /** The updated VAD state after this sample. */
  state: VADState;
  /** True exactly once when the required number of consecutive samples is met. */
  triggered: boolean;
}

/**
 * Evaluate a single RMS sample against the VAD state machine.
 *
 * Pure function — no side effects, no timers.
 *
 * Returns whether the VAD triggered **on this sample** (only fires once per
 * active period — reset by calling `createVADState` or setting
 * `state.triggered = false`).
 */
export function evaluateVADSample(
  rms: number,
  state: VADState,
  config: VADConfig = DEFAULT_VAD_CONFIG,
): VADEvaluateResult {
  const threshold = vadThreshold(config, state.noiseFloor);
  const newState: VADState = { ...state };

  if (rms > threshold) {
    newState.consecutiveAbove = state.consecutiveAbove + 1;
  } else {
    // Update noise floor estimate on quiet samples
    newState.noiseFloor = state.noiseFloor * 0.95 + rms * 0.05;
    newState.consecutiveAbove = 0;
  }

  if (newState.consecutiveAbove >= config.triggerSamples && !newState.triggered) {
    newState.triggered = true;
    return { state: newState, triggered: true };
  }

  return { state: newState, triggered: false };
}
