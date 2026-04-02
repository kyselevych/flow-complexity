import {
  Node,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  SyntaxKind,
  FunctionExpression,
} from 'ts-morph';

export type AnalyzableFunction =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression;

export function isAnalyzableFunction(node: Node): node is AnalyzableFunction {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  );
}

export function getFunctionName(node: AnalyzableFunction): string {
  if (Node.isFunctionDeclaration(node)) {
    return node.getName() ?? '<anonymous>';
  }
  if (Node.isMethodDeclaration(node)) {
    return node.getName();
  }
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const parent = node.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    if (parent && Node.isPropertyAssignment(parent)) {
      const nameNode = parent.getNameNode();
      return nameNode.getText();
    }
    return '<anonymous>';
  }
  return '<anonymous>';
}

export function getJSDocTags(node: AnalyzableFunction): Map<string, string | undefined> {
  const tags = new Map<string, string | undefined>();
  const jsDocs = node.getJsDocs();
  for (const doc of jsDocs) {
    for (const tag of doc.getTags()) {
      const tagName = tag.getTagName();
      const comment = tag.getComment();
      const commentText =
        typeof comment === 'string'
          ? comment
          : Array.isArray(comment)
          ? comment.map((c) => (typeof c === 'string' ? c : c?.getText() ?? '')).join('')
          : undefined;
      tags.set(tagName, commentText?.trim());
    }
  }
  return tags;
}

export function hasJSDocTag(node: AnalyzableFunction, tag: string): boolean {
  return getJSDocTags(node).has(tag);
}

export function getCallExpressions(node: AnalyzableFunction): Node[] {
  const body = node.getBody();

  if (!body) return [];

  const calls: Node[] = [];
  body.forEachDescendant((child) => {
    if (Node.isCallExpression(child)) {
      calls.push(child);
    }
  });
  return calls;
}

export function resolveCallTarget(callExpr: Node): AnalyzableFunction | undefined {
  if (!Node.isCallExpression(callExpr)) return undefined;

  const expr = callExpr.getExpression();
  if (Node.isIdentifier(expr)) {
    const defs = expr.getDefinitionNodes();
    for (const def of defs) {
      if (isAnalyzableFunction(def)) return def;
      if (Node.isVariableDeclaration(def)) {
        const initializer = def.getInitializer();
        if (initializer && isAnalyzableFunction(initializer)) return initializer;
      }
    }
  }
  if (Node.isPropertyAccessExpression(expr)) {
    const nameNode = expr.getNameNode();
    if (Node.isIdentifier(nameNode)) {
      const defs = nameNode.getDefinitionNodes();
      for (const def of defs) {
        if (isAnalyzableFunction(def)) return def;
      }
    }
  }
  return undefined;
}
