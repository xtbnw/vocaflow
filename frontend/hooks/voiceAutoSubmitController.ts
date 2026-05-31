/**
 * Pure controller for voice auto-submit with debounce.
 *
 * Separated from React hooks so the debounce / round-race logic
 * can be tested deterministically without DOM or ASR fixtures.
 */

export interface VoiceAutoSubmitOptions {
  /** Debounce delay in milliseconds. Default 800. */
  debounceMs?: number;
  /** Called when the debounce timer fires with non-empty accumulated text. */
  onSubmit: (text: string) => void;
}

export interface VoiceAutoSubmitController {
  /** Start a new listening round. Resets accumulated text and timer. Returns new roundId. */
  startRound(): number;
  /** Process a final result for the given round. Restarts debounce timer. */
  handleFinal(text: string, roundId: number): void;
  /** Stop current round. Clears timer. Stale round IDs are silently ignored. */
  stopRound(): void;
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

  let roundId = 0;
  let accumulated: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function startRound(): number {
    clearTimer();
    accumulated = [];
    roundId += 1;
    return roundId;
  }

  function handleFinal(text: string, rId: number): void {
    if (rId !== roundId) return;
    accumulated.push(text);
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      const aggregated = accumulated.join(" ").trim();
      // Invalidate current round BEFORE calling onSubmit so this round can
      // never submit again, even if a late final arrives with the same roundId.
      accumulated = [];
      roundId += 1;
      if (aggregated) {
        onSubmit(aggregated);
      }
    }, debounceMs);
  }

  function stopRound(): void {
    clearTimer();
    accumulated = [];
    roundId += 1;
  }

  function getText(): string {
    return accumulated.join(" ").trim();
  }

  function dispose(): void {
    clearTimer();
    accumulated = [];
  }

  return { startRound, handleFinal, stopRound, getText, dispose };
}
