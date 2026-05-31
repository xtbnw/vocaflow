// Barge-in orchestration — pure, testable logic.
// Executes the cancel sequence in deterministic order when the user
// interrupts TTS playback (via VAD or manual mic click).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BargeInDeps {
  /** Cancel the current TTS session and clear the PCM playback queue. */
  cancelTts: () => void;
  /** Abort the current Agent SSE stream without clearing threadId or messages. */
  abortSse: () => void;
  /** Stop VAD monitoring and release microphone resources. */
  stopVad: () => void;
  /** Start a new browser ASR listening round. */
  startAsr: () => void;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Execute the full barge-in sequence in deterministic order:
 *   1. Cancel TTS session (also clears PCM playback queue)
 *   2. Abort current Agent SSE request
 *   3. Stop VAD monitoring and release mic
 *   4. Start new ASR listening round
 *
 * This function is called both by the VAD trigger and by the manual
 * mic-click handler.  It is pure business logic — all side effects are
 * injected via `deps`.
 */
export function executeBargeIn(deps: BargeInDeps): void {
  try { deps.cancelTts(); } catch { /* best-effort — don't block subsequent cleanup */ }
  try { deps.abortSse(); } catch { /* best-effort */ }
  try { deps.stopVad(); } catch { /* best-effort */ }
  try { deps.startAsr(); } catch { /* best-effort */ }
}
