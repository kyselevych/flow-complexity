import { ComplexityResult, BigOClass } from '../types/complexity.js';
import { LLMClient } from '../evaluators/llm/llm-client.js';
import { LLMConfig } from '../types/config.js';
import { MemoCache } from '../cache/memo-cache.js';
import { createMicroEvaluator, MicroEvaluator } from '../evaluators/llm/micro-evaluator.js';
import { bigOFromClass } from '../complexity/complexity-math.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger({ prefix: 'whole-function-evaluator' });

const LLM_TIMEOUT_MS = 30_000;

export interface WholeFunctionEvaluator {
  evaluate(
    functionSource: string,
    functionName: string,
    inputVariable?: string,
  ): Promise<ComplexityResult>;
}

export function createWholeFunctionEvaluator(options: {
  llmClient: LLMClient;
  llmConfig: LLMConfig;
  cache: MemoCache;
}): WholeFunctionEvaluator {
  const { llmClient, llmConfig, cache } = options;
  const microEvaluator: MicroEvaluator = createMicroEvaluator({
    client: llmClient,
    config: llmConfig,
  });

  return {
    async evaluate(functionSource, functionName, inputVariable) {
      const cacheKey = `whole:${functionName}`;

      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      logger.info(`LLM fallback for "${functionName}" (deterministic analysis uncertain)`);

      const result = await Promise.race([
        microEvaluator.evaluate(functionSource, `${functionName}(...)`, inputVariable),
        new Promise<ComplexityResult>((resolve) =>
          setTimeout(() => {
            logger.warn(`LLM evaluation timed out after ${LLM_TIMEOUT_MS}ms for "${functionName}"`);
            resolve({
              complexity: bigOFromClass(BigOClass.Unknown),
              confidence: 0.0,
              source: 'llm',
              reasoning: `LLM evaluation timed out after ${LLM_TIMEOUT_MS}ms`,
            });
          }, LLM_TIMEOUT_MS),
        ),
      ]);

      cache.set(cacheKey, result);
      return result;
    },
  };
}
