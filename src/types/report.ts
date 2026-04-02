import { BigOExpression, ConfidenceScore } from './complexity.js';
import { SourceLocation } from './flow-graph.js';

export type ExitCode = 0 | 1 | 2 | 3;

export interface ReportEntry {
  readonly functionName: string;
  readonly location: SourceLocation;
  readonly complexity: BigOExpression;
  readonly confidence: ConfidenceScore;
  readonly exceedsThreshold: boolean;
  readonly lowConfidence: boolean;
  readonly treeOutput?: string;
}

export interface AnalysisReport {
  readonly entries: readonly ReportEntry[];
  readonly exitCode: ExitCode;
  readonly summary: {
    readonly totalFunctions: number;
    readonly thresholdExceeded: number;
    readonly lowConfidence: number;
    readonly errors: number;
  };
}
