import { Node, SyntaxKind } from 'ts-morph';
import { FlowNode } from '../../types/flow-graph.js';
import { ComplexityResult } from '../../types/complexity.js';
import { BigOClass } from '../../types/complexity.js';
import { bigOFromClass } from '../../complexity/complexity-math.js';
import { analyzeLoopBounds } from './loop-analyzer.js';

export interface PatternMatch {
  readonly pattern: string;  // name of the pattern matched
  readonly result: ComplexityResult;
}

const BUILTIN_COMPLEXITY: Record<string, BigOClass> = {
  'Array.prototype.sort': BigOClass.ONLogN,
  'Array.prototype.indexOf': BigOClass.ON,
  'Array.prototype.find': BigOClass.ON,
  'Array.prototype.filter': BigOClass.ON,
  'Array.prototype.map': BigOClass.ON,
  'Array.prototype.reduce': BigOClass.ON,
  'Array.prototype.forEach': BigOClass.ON,
  'Array.prototype.includes': BigOClass.ON,
  'Array.prototype.push': BigOClass.O1,
  'Array.prototype.pop': BigOClass.O1,
  'Map.prototype.get': BigOClass.O1,
  'Map.prototype.set': BigOClass.O1,
  'Map.prototype.has': BigOClass.O1,
  'Set.prototype.add': BigOClass.O1,
  'Set.prototype.has': BigOClass.O1,
  'Object.keys': BigOClass.ON,
  'Object.values': BigOClass.ON,
  'Object.entries': BigOClass.ON,
  'JSON.parse': BigOClass.ON,
  'JSON.stringify': BigOClass.ON,
  'Math.floor': BigOClass.O1,
  'Math.ceil': BigOClass.O1,
  'Math.abs': BigOClass.O1,
  'Math.max': BigOClass.O1,
  'Math.min': BigOClass.O1,
  'Math.round': BigOClass.O1,
  'Math.sqrt': BigOClass.O1,
  'Math.pow': BigOClass.O1,
  'Math.log': BigOClass.O1,
  'Math.random': BigOClass.O1,
  'Math.trunc': BigOClass.O1,
  'Math.sign': BigOClass.O1,
  'Array.from': BigOClass.ON,
  'Array.isArray': BigOClass.O1,
  'Array.prototype.shift': BigOClass.ON,
  'Array.prototype.unshift': BigOClass.ON,
  'Array.prototype.splice': BigOClass.ON,
  'Array.prototype.slice': BigOClass.ON,
  'Array.prototype.concat': BigOClass.ON,
  'Array.prototype.reverse': BigOClass.ON,
  'Array.prototype.flat': BigOClass.ON,
  'Array.prototype.fill': BigOClass.ON,
  'Array.prototype.join': BigOClass.ON,
  'Array.prototype.every': BigOClass.ON,
  'Array.prototype.some': BigOClass.ON,
  'Array.prototype.findIndex': BigOClass.ON,
};

const METHOD_NAME_MAP: Record<string, string> = {
  'sort': 'Array.prototype.sort',
  'indexOf': 'Array.prototype.indexOf',
  'find': 'Array.prototype.find',
  'filter': 'Array.prototype.filter',
  'map': 'Array.prototype.map',
  'reduce': 'Array.prototype.reduce',
  'forEach': 'Array.prototype.forEach',
  'includes': 'Array.prototype.includes',
  'push': 'Array.prototype.push',
  'pop': 'Array.prototype.pop',
  'shift': 'Array.prototype.shift',
  'unshift': 'Array.prototype.unshift',
  'splice': 'Array.prototype.splice',
  'slice': 'Array.prototype.slice',
  'concat': 'Array.prototype.concat',
  'reverse': 'Array.prototype.reverse',
  'flat': 'Array.prototype.flat',
  'fill': 'Array.prototype.fill',
  'join': 'Array.prototype.join',
  'every': 'Array.prototype.every',
  'some': 'Array.prototype.some',
  'findIndex': 'Array.prototype.findIndex',
};

const STATIC_METHOD_MAP: Record<string, string> = {
  'Object.keys': 'Object.keys',
  'Object.values': 'Object.values',
  'Object.entries': 'Object.entries',
  'JSON.parse': 'JSON.parse',
  'JSON.stringify': 'JSON.stringify',
  'Math.floor': 'Math.floor',
  'Math.ceil': 'Math.ceil',
  'Math.abs': 'Math.abs',
  'Math.max': 'Math.max',
  'Math.min': 'Math.min',
  'Math.round': 'Math.round',
  'Math.sqrt': 'Math.sqrt',
  'Math.pow': 'Math.pow',
  'Math.log': 'Math.log',
  'Math.random': 'Math.random',
  'Math.trunc': 'Math.trunc',
  'Math.sign': 'Math.sign',
  'Array.from': 'Array.from',
  'Array.isArray': 'Array.isArray',
};

const LOOP_KINDS = new Set([
  SyntaxKind.ForStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

function isLoopNode(node: Node): boolean {
  return LOOP_KINDS.has(node.getKind());
}

function countLoopDepth(node: Node): number {
  if (!isLoopNode(node)) {
    let maxChildDepth = 0;
    for (const child of node.getChildren()) {
      const d = countLoopDepth(child);
      if (d > maxChildDepth) maxChildDepth = d;
    }
    return maxChildDepth;
  }

  let maxBodyDepth = 0;
  for (const child of node.getChildren()) {
    const d = countLoopDepth(child);
    if (d > maxBodyDepth) maxBodyDepth = d;
  }
  return 1 + maxBodyDepth;
}

function hasHalvingLoop(node: Node): boolean {
  if (!isLoopNode(node)) {
    return node.getChildren().some((c) => hasHalvingLoop(c));
  }
  const bounds = analyzeLoopBounds(node);
  if (bounds.isHalving) return true;
  return node.getChildren().some((c) => hasHalvingLoop(c));
}

function getTopLevelLoops(node: Node): Node[] {
  const result: Node[] = [];
  node.forEachDescendant((child, traversal) => {
    if (isLoopNode(child)) {
      result.push(child);
      traversal.skip(); // don't recurse into this loop's body for top-level collection
    }
  });
  return result;
}

function checkCallComplexity(callNode: Node): BigOClass | undefined {
  if (!Node.isCallExpression(callNode)) return undefined;
  const expr = callNode.getExpression();

  if (Node.isPropertyAccessExpression(expr)) {
    const methodName = expr.getName();
    const canonicalName = METHOD_NAME_MAP[methodName];
    if (canonicalName !== undefined) {
      return BUILTIN_COMPLEXITY[canonicalName];
    }

    const fullText = expr.getText();
    if (/\.(get|set|has|delete)$/.test(fullText)) {
      const method = fullText.split('.').pop()!;
      const mapKey = `Map.prototype.${method}`;
      const setKey = `Set.prototype.${method}`;
      if (BUILTIN_COMPLEXITY[mapKey] !== undefined) {
        return BUILTIN_COMPLEXITY[mapKey];
      }
      if (BUILTIN_COMPLEXITY[setKey] !== undefined) {
        return BUILTIN_COMPLEXITY[setKey];
      }
    }

    if (STATIC_METHOD_MAP[fullText] !== undefined) {
      const canonical = STATIC_METHOD_MAP[fullText];
      return BUILTIN_COMPLEXITY[canonical];
    }
  }

  return undefined;
}

function findBuiltinCallComplexity(node: Node): BigOClass | undefined {
  // Check the node itself (leaf nodes are often CallExpressions)
  const selfResult = checkCallComplexity(node);
  if (selfResult !== undefined) return selfResult;

  let found: BigOClass | undefined;
  node.forEachDescendant((child) => {
    if (found !== undefined) return;
    found = checkCallComplexity(child);
  });

  return found;
}

function hasAnyFunctionCalls(node: Node): boolean {
  let found = false;
  node.forEachDescendant((child) => {
    if (found) return;
    if (Node.isCallExpression(child)) {
      found = true;
    }
  });
  return found;
}

function hasAnyLoops(node: Node): boolean {
  let found = false;
  node.forEachDescendant((child) => {
    if (found) return;
    if (isLoopNode(child)) found = true;
  });
  return found;
}

function hasRecursion(node: Node, functionName: string): boolean {
  let found = false;
  node.forEachDescendant((child) => {
    if (found) return;
    if (Node.isCallExpression(child)) {
      const calleeText = child.getExpression().getText();
      if (calleeText === functionName || calleeText === `this.${functionName}`) {
        found = true;
      }
    }
  });
  return found;
}

function makeResult(
  cls: BigOClass,
  reasoning: string,
): ComplexityResult {
  return {
    complexity: bigOFromClass(cls),
    confidence: 1.0,
    source: 'deterministic',
    reasoning,
  };
}

export function matchPattern(node: FlowNode): PatternMatch | undefined {
  const astNode = node.astNode;
  const functionName = node.metadata.functionName ?? '<anonymous>';

  {
    const calleeName = node.metadata.calleeName ?? '';
    if (/sort/.test(calleeName)) {
      return {
        pattern: 'sort-call',
        result: makeResult(BigOClass.ONLogN, 'Contains Array.sort — O(n log n)'),
      };
    }

    let hasSortCall = false;
    astNode.forEachDescendant((child) => {
      if (hasSortCall) return;
      if (Node.isCallExpression(child)) {
        const expr = child.getExpression();
        if (Node.isPropertyAccessExpression(expr)) {
          const name = expr.getName();
          if (name === 'sort') {
            hasSortCall = true;
          }
        }
        const callText = child.getExpression().getText();
        if (callText === 'sort') hasSortCall = true;
      }
    });

    if (hasSortCall) {
      return {
        pattern: 'sort-call',
        result: makeResult(BigOClass.ONLogN, 'Contains Array.sort — O(n log n)'),
      };
    }
  }

  {
    const cls = findBuiltinCallComplexity(astNode);
    if (cls !== undefined) {
      const notation = bigOFromClass(cls).notation;
      return {
        pattern: 'builtin-call',
        result: makeResult(cls, `Contains built-in method call — ${notation}`),
      };
    }
  }

  if (hasAnyLoops(astNode) && hasHalvingLoop(astNode)) {
    return {
      pattern: 'halving-loop',
      result: makeResult(BigOClass.OLogN, 'Loop with halving step — O(log n)'),
    };
  }

  {
    const depth = countLoopDepth(astNode);
    if (depth >= 3) {
      return {
        pattern: 'nested-loops-3',
        result: makeResult(BigOClass.ON3, `${depth}-deep nested loops — O(n³)`),
      };
    }
    if (depth === 2) {
      return {
        pattern: 'nested-loops-2',
        result: makeResult(BigOClass.ON2, 'Two-deep nested loops — O(n²)'),
      };
    }
    if (depth === 1) {
      return {
        pattern: 'single-loop',
        result: makeResult(BigOClass.ON, 'Single loop with O(1) body — O(n)'),
      };
    }
  }

  if (
    !hasAnyLoops(astNode) &&
    !hasRecursion(astNode, functionName)
  ) {
    return {
      pattern: 'constant',
      result: makeResult(BigOClass.O1, 'No loops, no recursion — O(1)'),
    };
  }

  return undefined;
}
