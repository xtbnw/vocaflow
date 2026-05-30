export interface LLMProviderConfig {
  url: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  readonly config: LLMProviderConfig;
  chat(messages: ChatMessage[]): Promise<string>;
}
