import { LLMClient } from './llm-client.js';
import { ComplexityResult, LLMRunResult } from '../../types/complexity.js';
import { LLMConfig } from '../../types/config.js';
import { buildComplexityPrompt } from './prompt-templates.js';
import { parseLLMResponse, toLLMRunResult } from './response-parser.js';
import { computeConsensus } from './consensus.js';
import { createLogger } from '../../util/logger.js';

const logger = createLogger({ prefix: 'micro-evaluator' });

export interface MicroEvaluatorOptions {
  readonly client: LLMClient;
  readonly config: LLMConfig;
}

export interface MicroEvaluator {
  evaluate(
    functionSource: string,
    callerContext?: string,
    inputVariable?: string
  ): Promise<ComplexityResult>;
}

export function createMicroEvaluator(options: MicroEvaluatorOptions): MicroEvaluator {
  const { client, config } = options;

  return {
    async evaluate(
      functionSource: string,
      callerContext?: string,
      inputVariable?: string
    ): Promise<ComplexityResult> {
      const prompt = buildComplexityPrompt({ functionSource, callerContext, inputVariable });

      const runs = config.runs ?? 3;
      const temperatures = config.temperatures;

      const resolvedTemperatures = getTemperatures(temperatures, runs);

      const runResults: LLMRunResult[] = [];

      for (let i = 0; i < runs; i++) {
        const temperature = resolvedTemperatures[i] ?? resolvedTemperatures[resolvedTemperatures.length - 1];

        try {
          const response = await client.complete(prompt, {
            model: config.model,
            maxTokens: config.maxTokens,
            temperature,
          });

          const parsed = parseLLMResponse(response.content);
          const runResult = toLLMRunResult(parsed, response.content);
          runResults.push(runResult);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`LLM run ${i + 1}/${runs} failed: ${message}`);
        }
      }

      if (runResults.length === 0) {
        throw new Error(`All ${runs} LLM runs failed — cannot compute consensus`);
      }

      return computeConsensus(runResults);
    },
  };
}

function getTemperatures(configured: readonly number[], runs: number): number[] {
  if (configured.length === 0) {
    return Array(runs).fill(0);
  }

  if (configured.length >= runs) {
    return configured.slice(0, runs) as number[];
  }

  if (configured.length === 1) {
    return Array(runs).fill(configured[0]);
  }

  const start = configured[0];
  const end = configured[configured.length - 1];
  const result: number[] = [];

  for (let i = 0; i < runs; i++) {
    const t = runs === 1 ? start : start + ((end - start) * i) / (runs - 1);
    result.push(t);
  }

  return result;
}
