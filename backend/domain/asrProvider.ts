/**
 * Abstract ASR provider interface.
 * Implementations: WebSpeechASRProvider (browser), FunASRProvider (future),
 * VolcanoASRProvider (future).
 *
 * Provider does NOT operate on UI — it fires callbacks and the consumer
 * decides how to render partial/final/error states.
 */
export interface ASRProvider {
  /** Start listening. Must call onPartialResult / onFinalResult / onError as results arrive. */
  start(): void;

  /** Stop listening and finalize the current utterance. */
  stop(): void;

  /** Whether the current runtime supports this provider. */
  isSupported(): boolean;

  /** Fired whenever a partial (interim) transcription is available. */
  onPartialResult: ((text: string) => void) | null;

  /** Fired when the final transcription for an utterance is ready. */
  onFinalResult: ((text: string) => void) | null;

  /** Fired on recognition errors. Consumer should surface the message to the user. */
  onError: ((message: string) => void) | null;
}
