import { Project, Node, VariableStatement } from 'ts-morph';
import { SourceLocation } from '../types/flow-graph.js';
import {
  AnalyzableFunction,
  isAnalyzableFunction,
  getFunctionName,
  getJSDocTags,
} from '../util/ast-helpers.js';
import * as path from 'path';
import * as fs from 'fs';

export interface ScanResult {
  readonly functionName: string;
  readonly filePath: string;
  readonly location: SourceLocation;
  readonly declaredInputVariable?: string;
  readonly astNode: AnalyzableFunction;
}

export interface ScannerOptions {
  readonly projectPath: string;
}

export interface Scanner {
  scan(): ScanResult[];
}

/**
 * Get effective JSDoc tags for a node, falling back to the parent
 * VariableStatement when the node is an arrow function or function expression
 * (ts-morph attaches JSDoc to the statement, not the initializer).
 */
function getEffectiveTags(node: AnalyzableFunction): Map<string, string | undefined> {
  const direct = getJSDocTags(node);
  if (direct.size > 0) return direct;

  // For arrow functions / function expressions: check the enclosing VariableStatement
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    // parent chain: ArrowFunction -> VariableDeclaration -> VariableDeclarationList -> VariableStatement
    const varDecl = node.getParent();
    if (!varDecl || !Node.isVariableDeclaration(varDecl)) return direct;
    const varDeclList = varDecl.getParent();
    if (!varDeclList || !Node.isVariableDeclarationList(varDeclList)) return direct;
    const varStmt = varDeclList.getParent();
    if (!varStmt || !Node.isVariableStatement(varStmt)) return direct;

    // Build tags map from the VariableStatement's JsDocs
    const tags = new Map<string, string | undefined>();
    for (const doc of (varStmt as VariableStatement).getJsDocs()) {
      for (const tag of doc.getTags()) {
        const comment = tag.getComment();
        const commentText =
          typeof comment === 'string'
            ? comment
            : Array.isArray(comment)
            ? comment.map((c) => (typeof c === 'string' ? c : c?.getText() ?? '')).join('')
            : undefined;
        tags.set(tag.getTagName(), commentText?.trim());
      }
    }
    return tags;
  }

  return direct;
}

function hasEffectiveJSDocTag(node: AnalyzableFunction, tag: string): boolean {
  return getEffectiveTags(node).has(tag);
}

export function createScanner(options: ScannerOptions): Scanner {
  return {
    scan(): ScanResult[] {
      let tsconfigPath = options.projectPath;
      const stat = fs.statSync(tsconfigPath, { throwIfNoEntry: false });
      if (stat?.isDirectory()) {
        tsconfigPath = path.join(tsconfigPath, 'tsconfig.json');
      }

      const project = new Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: false,
      });

      const results: ScanResult[] = [];

      for (const sourceFile of project.getSourceFiles()) {
        const filePath = sourceFile.getFilePath();

        const candidates: AnalyzableFunction[] = [];

        for (const fn of sourceFile.getFunctions()) {
          candidates.push(fn);
        }

        for (const varStatement of sourceFile.getVariableStatements()) {
          for (const varDecl of varStatement.getDeclarations()) {
            const init = varDecl.getInitializer();
            if (init && isAnalyzableFunction(init)) {
              candidates.push(init);
            }
          }
        }

        sourceFile.forEachDescendant((node) => {
          if (Node.isMethodDeclaration(node)) {
            candidates.push(node);
          }
        });

        for (const node of candidates) {
          if (!hasEffectiveJSDocTag(node, 'analyze-complexity')) continue;

          const name = getFunctionName(node);
          const startLine = node.getStartLineNumber();
          const endLine = node.getEndLineNumber();

          const tags = getEffectiveTags(node);
          const inputVar = tags.get('complexity-input');

          const location: SourceLocation = {
            filePath,
            startLine,
            endLine,
          };

          results.push({
            functionName: name,
            filePath,
            location,
            declaredInputVariable: inputVar ?? undefined,
            astNode: node,
          });
        }
      }

      return results;
    },
  };
}
