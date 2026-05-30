import type { ASRProvider } from "../../domain/asrProvider";
import { WebSpeechASRProvider } from "./webSpeechASRProvider";
import { NoopASRProvider } from "./noopASRProvider";

let cached: ASRProvider | null = null;

export function getASRProvider(): ASRProvider {
  if (cached) return cached;

  const web = new WebSpeechASRProvider();
  if (web.isSupported()) {
    cached = web;
  } else {
    cached = new NoopASRProvider();
  }

  return cached;
}
