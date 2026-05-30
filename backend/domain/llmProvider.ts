export interface LLMProviderConfig {
  url: string;
  apiKey: string;
  model: string;
}

export interface LLMProvider {
  readonly config: LLMProviderConfig;
  chat(prompt: string): Promise<string>;
}
