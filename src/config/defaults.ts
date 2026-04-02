import { AnalysisConfig, LLMConfig } from '../types/config.js';
import { BigOClass } from '../types/complexity.js';

export const DEFAULT_CONFIG: AnalysisConfig = {
  threshold: BigOClass.ON2,
  confidenceMin: 0.5,
  output: 'tree',
  noLlm: false,
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    runs: 3,
    temperatures: [0.3, 0.4, 0.5],
    maxTokens: 1024,
  },
  maxInlineDepth: 3,
  verbose: false,
};

export function mergeConfig(overrides: Partial<AnalysisConfig>): AnalysisConfig {
  const { llm: llmOverride, ...rest } = overrides;

  const mergedLlm: LLMConfig = llmOverride
    ? { ...DEFAULT_CONFIG.llm, ...llmOverride }
    : DEFAULT_CONFIG.llm;

  return {
    ...DEFAULT_CONFIG,
    ...rest,
    llm: mergedLlm,
  };
}
