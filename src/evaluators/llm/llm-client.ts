export interface LLMClientOptions {
  readonly model: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface LLMResponse {
  readonly content: string;
  readonly tokensUsed: {
    readonly input: number;
    readonly output: number;
  };
}

export interface LLMClient {
  complete(prompt: string, options: LLMClientOptions): Promise<LLMResponse>;
}
