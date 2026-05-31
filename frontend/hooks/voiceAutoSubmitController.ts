/**
 * Pure controller for voice auto-submit with debounce.
 *
 * Separated from React hooks so the debounce / session-race logic
 * can be tested deterministically without DOM or ASR fixtures.
 *
 * ## Voice session model
 *
 * A "voice session" begins when the user explicitly turns on the mic and ends
 * only when the user explicitly turns it off. Within a single session, the
 * controller automatically starts a new round after each debounced submit so
 * that consecutive speech segments are submitted without the user re-tapping
 * the mic button.
 *
 * - startSession() → returns a sessionToken
 * - Each call to handleFinal(text, sessionToken) feeds the current round
 * - When the debounce timer fires the accumulated text is submitted and a
 *   new round starts automatically within the same session
 * - stopSession() invalidates the session; late finals with stale tokens are
 *   silently ignored
 * - Manual close via stopSession() prevents any pending or future submission
 */

export interface VoiceAutoSubmitOptions {
  /** Debounce delay in milliseconds. Default 800. */
  debounceMs?: number;
  /** Called when the debounce timer fires with non-empty accumulated text. */
  onSubmit: (text: string) => void;
}

export interface VoiceAutoSubmitController {
  /** Start a new voice session. Returns a session token. */
  startSession(): number;
  /** Process a final result for the given session. Restarts debounce timer. */
  handleFinal(text: string, sessionToken: number): void;
  /** Stop current session. Clears timer. Ignores all future finals for this session. */
  stopSession(): void;
  /** Get current accumulated text. */
  getText(): string;
  /** Clean up resources. Safe to call multiple times. */
  dispose(): void;
}

export function createVoiceAutoSubmitController(
  options: VoiceAutoSubmitOptions,
): VoiceAutoSubmitController {
  const debounceMs = options.debounceMs ?? 800;
  const onSubmit = options.onSubmit;

  let sessionToken = 0;
  let roundId = 0;
  let accumulated: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleSubmit(token: number) {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      // Ignore if session was stopped while timer was pending
      if (sessionToken !== token) return;
      const aggregated = accumulated.join(" ").trim();
      // Start new round before onSubmit so handleFinal after submit
      // feeds the next round within the same session
      accumulated = [];
      roundId += 1;
      if (aggregated) {
        onSubmit(aggregated);
      }
    }, debounceMs);
  }

  function startSession(): number {
    clearTimer();
    accumulated = [];
    roundId = 0;
    sessionToken += 1;
    return sessionToken;
  }

  function handleFinal(text: string, token: number): void {
    if (token !== sessionToken) return;
    accumulated.push(text);
    scheduleSubmit(token);
  }

  function stopSession(): void {
    clearTimer();
    accumulated = [];
    roundId = 0;
    sessionToken += 1;
  }

  function getText(): string {
    return accumulated.join(" ").trim();
  }

  function dispose(): void {
    clearTimer();
    accumulated = [];
  }

  return { startSession, handleFinal, stopSession, getText, dispose };
}
