import type { LLMProvider, LLMProviderConfig } from "../../domain/llmProvider";

export class MockLLMProvider implements LLMProvider {
  readonly config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async chat(prompt: string): Promise<string> {
    return `[MockLLM | ${this.config.model}] received: "${prompt.slice(0, 120)}${prompt.length > 120 ? "…" : ""}"`;
  }
}
