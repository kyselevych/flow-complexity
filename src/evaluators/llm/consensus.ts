import { BigOClass, BigOExpression, ComplexityResult, LLMRunResult } from '../../types/complexity.js';
import { bigOFromClass, bigOMax } from '../../complexity/complexity-math.js';

/**
 * - All agree on the same class → confidence = 1.0 (N/N)
 * - Majority agrees → confidence = majority_count / N
 * - No majority (all different) → confidence = 1/N, result = max complexity (conservative)
 */
export function computeConsensus(runs: readonly LLMRunResult[]): ComplexityResult {
  if (runs.length === 0) {
    throw new Error('Cannot compute consensus from empty runs array');
  }

  const N = runs.length;

  const votes = new Map<BigOClass, number>();
  for (const run of runs) {
    const cls = run.complexity.class;
    votes.set(cls, (votes.get(cls) ?? 0) + 1);
  }

  let maxVotes = 0;
  let winnerClass: BigOClass = runs[0].complexity.class;
  for (const [cls, count] of votes) {
    if (count > maxVotes) {
      maxVotes = count;
      winnerClass = cls;
    }
  }

  const hasMajority = maxVotes > N / 2;

  const reasoning = runs
    .map((r, i) => `Run ${i + 1} [${r.complexity.notation}]: ${r.reasoning}`)
    .join(' | ');

  if (hasMajority) {
    const winnerRun = runs.find(r => r.complexity.class === winnerClass)!;
    const confidence = maxVotes / N;
    const complexity: BigOExpression = {
      class: winnerClass,
      variable: winnerRun.complexity.variable,
      notation: winnerRun.complexity.notation,
    };

    return {
      complexity,
      confidence,
      source: 'llm',
      reasoning,
      llmRuns: runs,
    };
  }

  let maxExpression: BigOExpression = runs[0].complexity;
  for (let i = 1; i < runs.length; i++) {
    maxExpression = bigOMax(maxExpression, runs[i].complexity);
  }

  return {
    complexity: maxExpression,
    confidence: 1 / N,
    source: 'llm',
    reasoning,
    llmRuns: runs,
  };
}
