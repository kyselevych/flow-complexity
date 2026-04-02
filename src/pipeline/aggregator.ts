import { Node } from 'ts-morph';
import { FlowNode } from '../types/flow-graph.js';
import { BigOClass, ComplexityResult } from '../types/complexity.js';
import {
  bigOFromClass,
  bigOMax,
  bigOMultiply,
} from '../complexity/complexity-math.js';
import { analyzeLoopBounds } from '../evaluators/deterministic/loop-analyzer.js';

const INPUT_UNRELATED_CONFIDENCE_PENALTY = 0.4;

function hasCollectionMutationInBody(node: FlowNode): boolean {
  if (node.kind !== 'loop') return false;
  try {
    const text = node.astNode.getText();
    // Detect exponential growth: a collection is both read (.map/.filter) and grown (.push(...spread))
    // in the same loop body. This suggests the collection doubles each iteration.
    // Pattern: someVar.map(...) AND someVar.push(...spread) in same loop body
    const collectionNames = new Set<string>();
    for (const m of text.matchAll(/(\w+)\.map\s*\(/g)) {
      collectionNames.add(m[1]);
    }
    for (const m of text.matchAll(/(\w+)\.flatMap\s*\(/g)) {
      collectionNames.add(m[1]);
    }
    if (collectionNames.size === 0) return false;
    for (const name of collectionNames) {
      const pushPattern = new RegExp(`${name}\\.push\\(\\s*\\.\\.\\.`);
      if (pushPattern.test(text)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function confidenceAfterMultiply(
  childConfidence: number,
  composed: import('../types/complexity.js').BigOExpression,
): number {
  if (composed.class === BigOClass.Unknown) {
    return 0.0;
  }
  return childConfidence;
}

function isLoopBoundRelatedToInput(
  loopBound: string | undefined,
  inputVariable: string | undefined,
): boolean {
  if (!inputVariable || !loopBound) return true;
  const inputBase = inputVariable.split('.')[0].split('[')[0];
  const boundText = loopBound.toLowerCase();
  const inputText = inputBase.toLowerCase();
  if (inputText.length < 2) return true; // too short to match reliably
  return boundText.includes(inputText);
}

export interface Aggregator {
  aggregate(flowTree: FlowNode, inputVariable?: string): ComplexityResult;
}

export function createAggregator(): Aggregator {
  return {
    aggregate(flowTree: FlowNode, inputVariable?: string): ComplexityResult {
      return aggregateNode(flowTree, inputVariable);
    },
  };
}

function aggregateNode(node: FlowNode, inputVariable?: string): ComplexityResult {
  let result: ComplexityResult;
  switch (node.kind) {
    case 'leaf':
      result = aggregateLeaf(node);
      break;
    case 'sequential':
      result = aggregateSequential(node, inputVariable);
      break;
    case 'branch':
      result = aggregateBranch(node, inputVariable);
      break;
    case 'loop':
      result = aggregateLoop(node, inputVariable);
      break;
    case 'for-await':
      result = aggregateForAwait(node, inputVariable);
      break;
    case 'async-parallel':
      result = aggregateAsyncParallel(node, inputVariable);
      break;
    case 'recursion':
      result = aggregateRecursion(node, inputVariable);
      break;
    default:
      result = {
        complexity: bigOFromClass(BigOClass.O1),
        confidence: 1.0,
        source: 'aggregated',
        reasoning: `Unknown node kind '${(node as FlowNode).kind}' — defaulting to O(1)`,
      };
  }
  (node as { result?: ComplexityResult }).result = result;
  return result;
}

function aggregateLeaf(node: FlowNode): ComplexityResult {
  if (node.result) {
    return node.result;
  }
  return {
    complexity: bigOFromClass(BigOClass.O1),
    confidence: 1.0,
    source: 'aggregated',
    reasoning: 'Leaf node with no pre-evaluated result — defaulting to O(1)',
  };
}

function aggregateSequential(node: FlowNode, inputVariable?: string): ComplexityResult {
  if (node.children.length === 0) {
    return {
      complexity: bigOFromClass(BigOClass.O1),
      confidence: 1.0,
      source: 'aggregated',
      reasoning: 'Empty sequential block — O(1)',
    };
  }

  const childResults = node.children.map((c) => aggregateNode(c, inputVariable));
  let best = childResults[0];
  for (let i = 1; i < childResults.length; i++) {
    best = pickMax(best, childResults[i]);
  }
  const minConf = Math.min(...childResults.map((r) => r.confidence));

  return {
    complexity: best.complexity,
    confidence: minConf,
    source: 'aggregated',
    reasoning: `Sequential block: max of ${childResults.length} children = ${best.complexity.notation}`,
  };
}

function aggregateBranch(node: FlowNode, inputVariable?: string): ComplexityResult {
  if (node.children.length === 0) {
    return {
      complexity: bigOFromClass(BigOClass.O1),
      confidence: 1.0,
      source: 'aggregated',
      reasoning: 'Empty branch — O(1)',
    };
  }

  const childResults = node.children.map((c) => aggregateNode(c, inputVariable));
  let dominant = childResults[0];
  for (let i = 1; i < childResults.length; i++) {
    const candidate = childResults[i];
    if (candidate.complexity.class > dominant.complexity.class) {
      dominant = candidate;
    }
  }

  return {
    complexity: dominant.complexity,
    confidence: dominant.confidence,
    source: 'aggregated',
    reasoning: `Branch: worst-case branch is ${dominant.complexity.notation}`,
  };
}

function aggregateLoop(node: FlowNode, inputVariable?: string): ComplexityResult {
  let isHalving = false;
  try {
    const loopBounds = analyzeLoopBounds(node.astNode);
    isHalving = loopBounds.isHalving;
  } catch {
    // astNode may be a mock/placeholder — skip halving detection
  }

  const loopBound = node.metadata.loopBound;
  const boundRelated = isLoopBoundRelatedToInput(loopBound, inputVariable);
  const hasMutation = hasCollectionMutationInBody(node);

  if (node.children.length === 0) {
    const cls = isHalving ? BigOClass.OLogN : BigOClass.ON;
    const complexity = bigOFromClass(cls);
    return {
      complexity,
      confidence: boundRelated ? 1.0 : INPUT_UNRELATED_CONFIDENCE_PENALTY,
      source: 'aggregated',
      reasoning: isHalving
        ? 'Halving loop with empty body — O(log n)'
        : `Loop with empty body — O(n)${!boundRelated ? ` (bound '${loopBound}' may not relate to input '${inputVariable}')` : ''}`,
    };
  }

  const childResults = node.children.map((c) => aggregateNode(c, inputVariable));
  let bodyResult = childResults[0];
  for (let i = 1; i < childResults.length; i++) {
    bodyResult = pickMax(bodyResult, childResults[i]);
  }

  const iterationClass = isHalving ? BigOClass.OLogN : BigOClass.ON;
  const iterationFactor = bigOFromClass(iterationClass);
  const composed = bigOMultiply(bodyResult.complexity, iterationFactor);
  const rawConfidence = childResults.reduce((acc, r) => acc * r.confidence, 1.0);
  let penalizedConfidence = boundRelated ? rawConfidence : rawConfidence * INPUT_UNRELATED_CONFIDENCE_PENALTY;
  if (hasMutation) {
    penalizedConfidence *= INPUT_UNRELATED_CONFIDENCE_PENALTY;
  }
  const confidence = confidenceAfterMultiply(penalizedConfidence, composed);

  const warnings: string[] = [];
  if (!boundRelated) warnings.push(`bound '${loopBound}' may not relate to input '${inputVariable}'`);
  if (hasMutation) warnings.push('loop body mutates a collection (push/splice with spread)');
  const warningStr = warnings.length > 0 ? ` (${warnings.join('; ')})` : '';

  return {
    complexity: composed,
    confidence,
    source: 'aggregated',
    reasoning: isHalving
      ? `Halving loop: body ${bodyResult.complexity.notation} × O(log n) = ${composed.notation}`
      : `Loop: body ${bodyResult.complexity.notation} × O(n) = ${composed.notation}${warningStr}`,
  };
}

function aggregateForAwait(node: FlowNode, inputVariable?: string): ComplexityResult {
  if (node.children.length === 0) {
    return {
      complexity: bigOFromClass(BigOClass.ON),
      confidence: 1.0,
      source: 'aggregated',
      reasoning: 'for-await with empty body — O(n)',
    };
  }

  const childResults = node.children.map((c) => aggregateNode(c, inputVariable));
  let bodyResult = childResults[0];
  for (let i = 1; i < childResults.length; i++) {
    bodyResult = pickMax(bodyResult, childResults[i]);
  }

  const n = bigOFromClass(BigOClass.ON);
  const composed = bigOMultiply(bodyResult.complexity, n);
  const rawConfidence = childResults.reduce((acc, r) => acc * r.confidence, 1.0);
  const confidence = confidenceAfterMultiply(rawConfidence, composed);

  return {
    complexity: composed,
    confidence,
    source: 'aggregated',
    reasoning: `for-await: body ${bodyResult.complexity.notation} × O(n) = ${composed.notation}`,
  };
}

function aggregateAsyncParallel(node: FlowNode, inputVariable?: string): ComplexityResult {
  if (node.children.length === 0) {
    return {
      complexity: bigOFromClass(BigOClass.O1),
      confidence: 1.0,
      source: 'aggregated',
      reasoning: 'Async-parallel with no tasks — O(1)',
    };
  }

  const childResults = node.children.map((c) => aggregateNode(c, inputVariable));
  let best = childResults[0];
  for (let i = 1; i < childResults.length; i++) {
    best = pickMax(best, childResults[i]);
  }
  const minConf = Math.min(...childResults.map((r) => r.confidence));

  return {
    complexity: best.complexity,
    confidence: minConf,
    source: 'aggregated',
    reasoning: `Async-parallel: bottleneck is ${best.complexity.notation}`,
  };
}

function aggregateRecursion(node: FlowNode, inputVariable?: string): ComplexityResult {
  const shrink = node.metadata.recursionShrink ?? 'unknown';

  if (shrink === 'unknown') {
    return {
      complexity: bigOFromClass(BigOClass.Unknown),
      confidence: 0.0,
      source: 'aggregated',
      reasoning: 'Recursion with unknown shrink pattern — complexity undetermined',
    };
  }

  let bodyResult: ComplexityResult;
  if (node.children.length > 0) {
    const childResults = node.children.map((c) => aggregateNode(c, inputVariable));
    bodyResult = childResults[0];
    for (let i = 1; i < childResults.length; i++) {
      bodyResult = pickMax(bodyResult, childResults[i]);
    }
  } else {
    bodyResult = {
      complexity: bigOFromClass(BigOClass.O1),
      confidence: 1.0,
      source: 'aggregated',
      reasoning: 'Recursion with no explicit body children — O(1) body assumed',
    };
  }

  if (shrink === 'linear') {
    const factor = bigOFromClass(BigOClass.ON);
    const composed = bigOMultiply(bodyResult.complexity, factor);
    return {
      complexity: composed,
      confidence: confidenceAfterMultiply(bodyResult.confidence * 0.8, composed),
      source: 'aggregated',
      reasoning: `Linear recursion: body ${bodyResult.complexity.notation} × O(n) = ${composed.notation}`,
    };
  }

  const factor = bigOFromClass(BigOClass.OLogN);
  const composed = bigOMultiply(bodyResult.complexity, factor);
  return {
    complexity: composed,
    confidence: confidenceAfterMultiply(bodyResult.confidence * 0.8, composed),
    source: 'aggregated',
    reasoning: `Halving recursion: body ${bodyResult.complexity.notation} × O(log n) = ${composed.notation}`,
  };
}

function pickMax(a: ComplexityResult, b: ComplexityResult): ComplexityResult {
  return bigOMax(a.complexity, b.complexity) === a.complexity ? a : b;
}
