import { FlowNode } from './flow-graph.js';

export type LeafClassification = 'deterministic' | 'semantic';

export interface ClassifiedLeaf {
  readonly node: FlowNode;
  readonly classification: LeafClassification;
  readonly reason: string;
  readonly builtinComplexity?: string;  // for known builtins like "Array.sort" → "O(n log n)"
}

export interface ClassificationResult {
  readonly leaves: readonly ClassifiedLeaf[];
  readonly deterministicCount: number;
  readonly semanticCount: number;
}
