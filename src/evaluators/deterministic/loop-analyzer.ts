import { Node, SyntaxKind } from 'ts-morph';

export interface LoopBounds {
  readonly variable?: string;
  readonly bound?: string;
  readonly isHalving: boolean;
  readonly isInputDependent: boolean;
}

function detectHalvingUpdate(loopNode: Node): boolean {
  let found = false;

  loopNode.forEachDescendant((node) => {
    if (found) return;

    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getText();
      if (op === '/=' || op === '>>=' || op === '*=') {
        const right = node.getRight().getText().trim();
        if (op === '/=') {
          if (/^[0-9]+$/.test(right) && parseInt(right, 10) >= 2) {
            found = true;
          }
        } else if (op === '>>=') {
          if (/^[0-9]+$/.test(right) && parseInt(right, 10) >= 1) {
            found = true;
          }
        } else if (op === '*=') {
          if (/^[0-9]+$/.test(right) && parseInt(right, 10) >= 2) {
            found = true;
          }
        }
      }

      if (op === '=') {
        const right = node.getRight().getText().replace(/\s/g, '');
        const left = node.getLeft().getText().replace(/\s/g, '');
        if (
          new RegExp(`^${left}/[0-9]+$`).test(right) ||
          new RegExp(`^${left}>>[0-9]+$`).test(right) ||
          new RegExp(`^${left}\\*[0-9]+$`).test(right) ||
          new RegExp(`^Math\\.floor\\(${left}/[0-9]+\\)$`).test(right) ||
          /^Math\.floor\(\w+\/[0-9]+\)$/.test(right)
        ) {
          found = true;
        }
      }
    }
  });

  return found;
}

function extractLoopVariable(loopNode: Node): string | undefined {
  if (Node.isForStatement(loopNode)) {
    const init = loopNode.getInitializer();
    if (init && Node.isVariableDeclarationList(init)) {
      const decls = init.getDeclarations();
      if (decls.length > 0) {
        return decls[0].getName();
      }
    }
    return undefined;
  }

  if (Node.isForOfStatement(loopNode)) {
    const init = loopNode.getInitializer();
    if (Node.isVariableDeclarationList(init)) {
      const decls = init.getDeclarations();
      if (decls.length > 0) {
        return decls[0].getName();
      }
    }
    return undefined;
  }

  if (Node.isForInStatement(loopNode)) {
    const init = loopNode.getInitializer();
    if (Node.isVariableDeclarationList(init)) {
      const decls = init.getDeclarations();
      if (decls.length > 0) {
        return decls[0].getName();
      }
    }
    return undefined;
  }

  if (Node.isWhileStatement(loopNode) || Node.isDoStatement(loopNode)) {
    const condition =
      Node.isWhileStatement(loopNode)
        ? loopNode.getExpression().getText()
        : loopNode.getExpression().getText();
    const match = condition.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    return match ? match[1] : undefined;
  }

  return undefined;
}

function extractLoopBound(loopNode: Node): string | undefined {
  if (Node.isForStatement(loopNode)) {
    const cond = loopNode.getCondition();
    if (cond && Node.isBinaryExpression(cond)) {
      const op = cond.getOperatorToken().getText();
      if (op === '<' || op === '<=') {
        return cond.getRight().getText();
      }
      if (op === '>' || op === '>=') {
        return cond.getLeft().getText();
      }
    }
    return undefined;
  }

  if (Node.isForOfStatement(loopNode)) {
    return loopNode.getExpression().getText();
  }

  if (Node.isForInStatement(loopNode)) {
    return loopNode.getExpression().getText();
  }

  if (Node.isWhileStatement(loopNode) || Node.isDoStatement(loopNode)) {
    const cond = Node.isWhileStatement(loopNode)
      ? loopNode.getExpression()
      : loopNode.getExpression();
    if (Node.isBinaryExpression(cond)) {
      const op = cond.getOperatorToken().getText();
      if (op === '>' || op === '>=' || op === '<' || op === '<=') {
        const left = cond.getLeft().getText();
        const right = cond.getRight().getText();
        if (/^[0-9]+$/.test(right)) return left;
        if (/^[0-9]+$/.test(left)) return right;
        return right;
      }
    }
    return cond.getText();
  }

  return undefined;
}

function isInputDependent(bound: string | undefined): boolean {
  if (!bound) return false;
  if (/^[0-9]+$/.test(bound.trim())) return false;
  return true;
}

function detectBinarySearchPattern(loopNode: Node): boolean {
  const bodyText = loopNode.getText();

  const hasMidComputation =
    /Math\.floor\(.*\/\s*2\)/.test(bodyText) ||
    /=\s*\(.*\)\s*\/\s*2/.test(bodyText) ||
    /=\s*\w+\s*>>\s*1/.test(bodyText);

  if (!hasMidComputation) return false;

  const hasBoundReassignment =
    /=\s*mid\s*[+-]\s*\d+/.test(bodyText) ||
    /=\s*mid\s*;/.test(bodyText);

  return hasBoundReassignment;
}

export function analyzeLoopBounds(loopNode: Node): LoopBounds {
  const variable = extractLoopVariable(loopNode);
  const bound = extractLoopBound(loopNode);
  const halving = detectHalvingUpdate(loopNode) || detectBinarySearchPattern(loopNode);

  return {
    variable,
    bound,
    isHalving: halving,
    isInputDependent: isInputDependent(bound),
  };
}
