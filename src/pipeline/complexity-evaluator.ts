import { FlowNode } from '../types/flow-graph.js';
import { ClassifiedLeaf, ClassificationResult } from '../types/classification.js';
import { ComplexityResult, BigOClass } from '../types/complexity.js';
import { LLMClient } from '../evaluators/llm/llm-client.js';
import { LLMConfig } from '../types/config.js';
import { MemoCache } from '../cache/memo-cache.js';
import { matchPattern } from '../evaluators/deterministic/patterns.js';
import { createMicroEvaluator, MicroEvaluator } from '../evaluators/llm/micro-evaluator.js';
import { extractFunctionSource, extractCallerContext } from '../util/source-extract.js';
import { bigOFromClass } from '../complexity/complexity-math.js';
import { AnalyzableFunction } from '../util/ast-helpers.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger({ prefix: 'complexity-evaluator' });

export interface ComplexityEvaluatorOptions {
  readonly llmClient?: LLMClient;  // undefined if --no-llm mode
  readonly llmConfig: LLMConfig;
  readonly cache: MemoCache;
  readonly noLlm: boolean;
}

export interface ComplexityEvaluator {
  /** Evaluate all classified leaves, populating their FlowNode.result fields */
  evaluateLeaves(classification: ClassificationResult): Promise<void>;
}

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `hash_${hash >>> 0}`;
}

function cacheKeyFor(leaf: ClassifiedLeaf): string {
  const calleeName = leaf.node.metadata.calleeName;
  if (calleeName) {
    return calleeName;
  }
  return simpleHash(leaf.node.astNode.getText());
}

export function createComplexityEvaluator(options: ComplexityEvaluatorOptions): ComplexityEvaluator {
  const { llmClient, llmConfig, cache, noLlm } = options;

  let microEvaluator: MicroEvaluator | undefined;
  if (llmClient && !noLlm) {
    microEvaluator = createMicroEvaluator({ client: llmClient, config: llmConfig });
  }

  return {
    async evaluateLeaves(classification: ClassificationResult): Promise<void> {
      for (const leaf of classification.leaves) {
        const key = cacheKeyFor(leaf);

        const cached = cache.get(key);
        if (cached) {
          (leaf.node as { result?: ComplexityResult }).result = cached;
          continue;
        }

        let result: ComplexityResult;

        if (leaf.classification === 'deterministic') {
          const match = matchPattern(leaf.node);
          if (match) {
            result = match.result;
          } else {
            // Fallback: deterministic leaf with no recognized pattern -> O(1)
            result = {
              complexity: bigOFromClass(BigOClass.O1),
              confidence: 1.0,
              source: 'deterministic',
              reasoning: 'No deterministic pattern matched — defaulting to O(1)',
            };
          }
        } else {
          if (microEvaluator) {
            let functionSource: string;
            try {
              functionSource = extractFunctionSource(leaf.node.astNode as AnalyzableFunction);
            } catch {
              functionSource = leaf.node.astNode.getText();
            }

            let callerContext: string | undefined;
            try {
              callerContext = extractCallerContext(leaf.node.astNode as AnalyzableFunction);
            } catch {
              callerContext = undefined;
            }

            const LLM_TIMEOUT_MS = 30_000;
            result = await Promise.race([
              microEvaluator.evaluate(functionSource, callerContext),
              new Promise<ComplexityResult>((resolve) =>
                setTimeout(() => {
                  logger.warn(`LLM evaluation timed out after ${LLM_TIMEOUT_MS}ms for "${key}"`);
                  resolve({
                    complexity: bigOFromClass(BigOClass.Unknown),
                    confidence: 0.0,
                    source: 'llm',
                    reasoning: `LLM evaluation timed out after ${LLM_TIMEOUT_MS}ms`,
                  });
                }, LLM_TIMEOUT_MS),
              ),
            ]);
          } else {
            result = {
              complexity: bigOFromClass(BigOClass.Unknown),
              confidence: 0.0,
              source: 'llm',
              reasoning: 'LLM evaluation disabled (--no-llm mode) — complexity unknown',
            };
          }
        }

        (leaf.node as { result?: ComplexityResult }).result = result;
        cache.set(key, result);
      }
    },
  };
}
