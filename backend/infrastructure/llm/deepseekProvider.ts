import type { LLMProvider, LLMProviderConfig } from "../../domain/llmProvider";

interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekResponse {
  choices: { message: { content: string } }[];
}

export class DeepSeekProvider implements LLMProvider {
  readonly config: LLMProviderConfig;

  static fromEnv(overrides?: Partial<LLMProviderConfig>): DeepSeekProvider {
    return new DeepSeekProvider({
      url: overrides?.url ?? "https://api.deepseek.com/chat/completions",
      apiKey: overrides?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      model: overrides?.model ?? "deepseek-v4-pro",
    });
  }

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async chat(prompt: string): Promise<string> {
    const messages: DeepSeekMessage[] = [
      { role: "user", content: prompt },
    ];

    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${text}`);
    }

    const data: DeepSeekResponse = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (content == null) {
      throw new Error("DeepSeek API returned empty response");
    }
    return content;
  }
}
