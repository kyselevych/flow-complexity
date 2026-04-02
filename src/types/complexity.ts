// Regular enum (not const enum) for ESM compatibility and runtime iteration
export enum BigOClass {
  O1 = 0, OLogN = 1, ON = 2, ONLogN = 3, ON2 = 4, ON3 = 5, O2N = 6, ONFact = 7, Unknown = 99
}

export interface BigOExpression {
  readonly class: BigOClass;
  readonly variable: string;       // "n", "items.length"
  readonly notation: string;       // "O(n^2)"
}

export type ConfidenceScore = number;  // [0, 1]

export interface LLMRunResult {
  readonly complexity: BigOExpression;
  readonly reasoning: string;
  readonly rawResponse: string;
}

export interface ComplexityResult {
  readonly complexity: BigOExpression;
  readonly confidence: ConfidenceScore;
  readonly source: 'deterministic' | 'llm' | 'aggregated';
  readonly reasoning: string;
  readonly llmRuns?: readonly LLMRunResult[];
}
