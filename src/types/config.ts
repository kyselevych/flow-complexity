import { BigOClass } from './complexity.js';

export interface LLMConfig {
  readonly provider: string;
  readonly model: string;
  readonly runs: number;
  readonly temperatures: readonly number[];
  readonly maxTokens: number;
  readonly apiKey?: string;
}

export interface AnalysisConfig {
  readonly threshold: BigOClass;
  readonly confidenceMin: number;
  readonly output: 'tree' | 'json' | 'markdown';
  readonly noLlm: boolean;
  readonly llm: LLMConfig;
  readonly maxInlineDepth: number;
  readonly verbose: boolean;
}
