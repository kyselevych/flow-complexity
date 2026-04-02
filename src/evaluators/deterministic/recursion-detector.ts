import { Node, SyntaxKind } from 'ts-morph';
import { RecursionShrinkPattern } from '../../types/flow-graph.js';

export interface RecursionInfo {
  readonly shrinkPattern: RecursionShrinkPattern;
  readonly recursiveCallCount: number;
}

function classifyArgument(argText: string, paramName: string): RecursionShrinkPattern {
  const normalized = argText.replace(/\s/g, '');

  const halvingPatterns = [
    new RegExp(`^${paramName}/[2-9][0-9]*$`),
    new RegExp(`^${paramName}>>[0-9]+$`),
    new RegExp(`^Math\\.(floor|ceil)\\(${paramName}/[2-9][0-9]*\\)$`),
    /^[a-zA-Z_$][a-zA-Z0-9_$.]*\.slice\(0,/,
    /^mid$/,
    /^(lo|hi|low|high|left|right|mid)$/,
  ];

  for (const pattern of halvingPatterns) {
    if (pattern.test(normalized)) return 'halving';
  }

  const linearPatterns = [
    new RegExp(`^${paramName}-[0-9]+$`),
    /^[a-zA-Z_$][a-zA-Z0-9_$.]*\.slice\(1\)$/,
    /^[a-zA-Z_$][a-zA-Z0-9_$.]*\.slice\([1-9][0-9]*\)$/,
    /^[a-zA-Z_$][a-zA-Z0-9_$.]*\.(tail|rest|next)$/,
  ];

  for (const pattern of linearPatterns) {
    if (pattern.test(normalized)) return 'linear';
  }

  return 'unknown';
}

export function analyzeRecursion(node: Node, functionName: string): RecursionInfo {
  const recursiveCalls: string[][] = []; // argument texts for each recursive call

  node.forEachDescendant((child) => {
    if (Node.isCallExpression(child)) {
      const calleeText = child.getExpression().getText();
      if (calleeText === functionName || calleeText === `this.${functionName}`) {
        const argTexts = child.getArguments().map((a) => a.getText());
        recursiveCalls.push(argTexts);
      }
    }
  });

  if (recursiveCalls.length === 0) {
    return { shrinkPattern: 'unknown', recursiveCallCount: 0 };
  }

  let overallPattern: RecursionShrinkPattern = 'unknown';

  for (const args of recursiveCalls) {
    for (const arg of args) {
      const pattern = classifyArgument(arg, functionName);
      if (pattern !== 'unknown') {
        if (overallPattern === 'unknown') {
          overallPattern = pattern;
        } else if (pattern === 'halving') {
          overallPattern = 'halving';
        }
        break;
      }
    }
    if (overallPattern !== 'unknown') break;
  }

  if (overallPattern === 'unknown') {
    let paramNames: string[] = [];
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node)
    ) {
      paramNames = (node as { getParameters(): { getName(): string }[] })
        .getParameters()
        .map((p) => p.getName());
    }

    for (const args of recursiveCalls) {
      for (const arg of args) {
        for (const paramName of paramNames) {
          const pattern = classifyArgument(arg, paramName);
          if (pattern !== 'unknown') {
            if (overallPattern === 'unknown') {
              overallPattern = pattern;
            } else if (pattern === 'halving') {
              overallPattern = 'halving';
            }
          }
        }
      }
    }
  }

  return {
    shrinkPattern: overallPattern,
    recursiveCallCount: recursiveCalls.length,
  };
}
