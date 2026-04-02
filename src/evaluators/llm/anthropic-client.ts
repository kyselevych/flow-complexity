import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, LLMClientOptions, LLMResponse } from './llm-client.js';

export function createAnthropicClient(apiKey?: string): LLMClient {
  const client = new Anthropic({ apiKey });

  return {
    async complete(prompt: string, options: LLMClientOptions): Promise<LLMResponse> {
      const message = await client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        messages: [{ role: 'user', content: prompt }],
      });

      const textContent = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      return {
        content: textContent,
        tokensUsed: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
        },
      };
    },
  };
}
