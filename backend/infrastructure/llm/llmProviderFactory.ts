import type { LLMProvider } from "../../domain/llmProvider";
import { DeepSeekProvider } from "./deepseekProvider";
import { MockLLMProvider } from "./mockLLMProvider";

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (apiKey) {
    cached = DeepSeekProvider.fromEnv();
  } else {
    cached = new MockLLMProvider({
      url: "",
      apiKey: "",
      model: "mock",
    });
  }

  return cached;
}
