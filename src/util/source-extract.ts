import { AnalyzableFunction, getFunctionName } from './ast-helpers.js';

export function extractFunctionSource(node: AnalyzableFunction): string {
  const raw = node.getText();

  let text = raw.replace(/^\/\*\*[\s\S]*?\*\/\s*/m, '');

  text = text.replace(/\/\/[^\n]*/g, '');
  text = text.replace(/\/\*(?!\*)[\s\S]*?\*\//g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

  return text.trim();
}

export function extractCallerContext(node: AnalyzableFunction): string {
  const name = getFunctionName(node);

  const params = node
    .getParameters()
    .map((p) => p.getText())
    .join(', ');

  let returnType = '';
  const retTypeNode = node.getReturnTypeNode();
  if (retTypeNode) {
    returnType = `: ${retTypeNode.getText()}`;
  }

  return `${name}(${params})${returnType}`;
}
