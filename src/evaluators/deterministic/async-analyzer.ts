import { Node, SyntaxKind } from 'ts-morph';

export type AsyncPattern = 'parallel' | 'sequential' | 'for-await' | 'none';

/**
 * Priority order (first match wins):
 *   1. 'parallel'   — contains Promise.all(...)
 *   2. 'for-await'  — contains for await (...)
 *   3. 'sequential' — contains multiple top-level await expressions
 *   4. 'none'       — no async pattern detected
 */
export function analyzeAsyncPattern(node: Node): AsyncPattern {
  let hasPromiseAll = false;
  let hasForAwait = false;
  let awaitCount = 0;

  node.forEachDescendant((child) => {
    if (Node.isCallExpression(child)) {
      const calleeText = child.getExpression().getText();
      if (calleeText === 'Promise.all' || calleeText === 'Promise.allSettled') {
        hasPromiseAll = true;
      }
    }

    // ts-morph ForOfStatement does not expose isAwait() directly
    if (Node.isForOfStatement(child)) {
      const hasAwaitKeyword = child.getChildren().some(
        (c) => c.getKind() === SyntaxKind.AwaitKeyword,
      );
      if (hasAwaitKeyword) {
        hasForAwait = true;
      }
    }

    if (Node.isAwaitExpression(child)) {
      let ancestor: Node | undefined = child.getParent();
      let isNested = false;
      while (ancestor && ancestor !== node) {
        const kind = ancestor.getKind();
        if (
          kind === SyntaxKind.FunctionDeclaration ||
          kind === SyntaxKind.FunctionExpression ||
          kind === SyntaxKind.ArrowFunction ||
          kind === SyntaxKind.MethodDeclaration
        ) {
          isNested = true;
          break;
        }
        ancestor = ancestor.getParent();
      }
      if (!isNested) {
        awaitCount++;
      }
    }
  });

  if (hasPromiseAll) return 'parallel';
  if (hasForAwait) return 'for-await';
  if (awaitCount >= 2) return 'sequential';

  return 'none';
}
