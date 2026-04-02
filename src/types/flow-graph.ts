import { Node } from 'ts-morph';
import { ComplexityResult } from './complexity.js';

export type ControlFlowKind =
  | 'sequential' | 'branch' | 'loop'
  | 'async-parallel' | 'for-await'
  | 'recursion' | 'leaf';

export interface SourceLocation {
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
}

export type RecursionShrinkPattern = 'linear' | 'halving' | 'unknown';

export interface FlowNodeMetadata {
  readonly functionName?: string;
  readonly loopVariable?: string;
  readonly loopBound?: string;
  readonly recursionShrink?: RecursionShrinkPattern;
  readonly isExternal?: boolean;
  readonly calleeName?: string;
  readonly expressionLabel?: string;
}

export interface FlowNode {
  readonly id: string;
  readonly kind: ControlFlowKind;
  readonly astNode: Node;
  readonly location: SourceLocation;
  readonly children: readonly FlowNode[];
  readonly metadata: FlowNodeMetadata;
  result?: ComplexityResult;  // populated during evaluation
}

export interface AnalysisTarget {
  readonly functionName: string;
  readonly filePath: string;
  readonly location: SourceLocation;
  readonly declaredInputVariable?: string;  // from @complexity-input
  readonly flowTree: FlowNode;
}
