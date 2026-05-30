import type { LLMProvider, LLMProviderConfig, ChatMessage } from "../../domain/llmProvider";

export class MockLLMProvider implements LLMProvider {
  readonly config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const preview = lastUser?.content.slice(0, 120) ?? "(empty)";
    return `[MockLLM | ${this.config.model}] received ${messages.length} messages, last user: "${preview}${lastUser && lastUser.content.length > 120 ? "…" : ""}"`;
  }
}
