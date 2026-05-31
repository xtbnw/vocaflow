// Barge-in orchestration — pure, testable logic.
// Executes the cancel sequence in deterministic order when the user
// interrupts TTS playback (via VAD or manual mic click).
//
// ## Relationship with persistent voice mode
//
// When the voice mode is already active (ASR continuously listening), barge-in
// must NOT restart ASR because doing so would clear the current in-progress
// transcription. Instead it only cancels the current AI reply (TTS + SSE) and
// stops VAD monitoring. The ASR stays on, preserving whatever the user was
// saying.
//
// When voice mode is NOT active, barge-in ensures ASR is started so the user
// can immediately speak after the interruption.

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
  /** Ensure ASR is listening. Called only when ASR is not already active.
   *  When ASR is already on, this is skipped to preserve current transcription. */
  ensureAsr: () => void;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Execute the full barge-in sequence in deterministic order:
 *   1. Cancel TTS session (also clears PCM playback queue)
 *   2. Abort current Agent SSE request
 *   3. Stop VAD monitoring and release mic
 *   4. Ensure ASR is listening (skipped if already on to preserve transcription)
 *
 * This function is called both by the VAD trigger and by the manual
 * mic-click handler.  It is pure business logic — all side effects are
 * injected via `deps`.
 */
export function executeBargeIn(deps: BargeInDeps): void {
  try { deps.cancelTts(); } catch { /* best-effort — don't block subsequent cleanup */ }
  try { deps.abortSse(); } catch { /* best-effort */ }
  try { deps.stopVad(); } catch { /* best-effort */ }
  try { deps.ensureAsr(); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Split variant for callers that already control ASR state
// ---------------------------------------------------------------------------

/**
 * Cancel the current AI reply without touching ASR.
 * Useful when the user interrupts via voice while ASR is already active.
 */
export function cancelCurrentReply(deps: Omit<BargeInDeps, "ensureAsr">): void {
  try { deps.cancelTts(); } catch {}
  try { deps.abortSse(); } catch {}
  try { deps.stopVad(); } catch {}
}
