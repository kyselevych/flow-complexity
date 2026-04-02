import {
  Node,
  Project,
  ForOfStatement,
  ForInStatement,
  ForStatement,
  WhileStatement,
  DoStatement,
  IfStatement,
  SwitchStatement,
  CallExpression,
} from 'ts-morph';
import {
  FlowNode,
  AnalysisTarget,
  SourceLocation,
  ControlFlowKind,
  FlowNodeMetadata,
  RecursionShrinkPattern,
} from '../types/flow-graph.js';
import { ScanResult } from './scanner.js';
import {
  AnalyzableFunction,
  getFunctionName,
  resolveCallTarget,
} from '../util/ast-helpers.js';

export interface CallGraphBuilderOptions {
  readonly project: Project;
  readonly maxInlineDepth: number; // default 3
}

export interface CallGraphBuilder {
  buildFlowTree(scanResult: ScanResult): AnalysisTarget;
}

export function createCallGraphBuilder(
  options: CallGraphBuilderOptions,
): CallGraphBuilder {
  return {
    buildFlowTree(scanResult: ScanResult): AnalysisTarget {
      const ctx = new BuildContext(options.maxInlineDepth);
      const flowTree = ctx.buildFunction(scanResult.astNode, 0, new Set());

      // Ensure the root node carries the function name for display
      if (!flowTree.metadata.functionName) {
        (flowTree.metadata as FlowNodeMetadata & { functionName?: string }).functionName = scanResult.functionName;
      }

      return {
        functionName: scanResult.functionName,
        filePath: scanResult.filePath,
        location: scanResult.location,
        declaredInputVariable: scanResult.declaredInputVariable,
        flowTree,
      };
    },
  };
}


class BuildContext {
  private counter = 0;
  private readonly maxInlineDepth: number;
  /** Map of nested function declarations visible in the current scope */
  private nestedFunctions: Map<string, AnalyzableFunction> = new Map();

  constructor(maxInlineDepth: number) {
    this.maxInlineDepth = maxInlineDepth;
  }

  private nextId(): string {
    return `node_${++this.counter}`;
  }

  private locationOf(node: Node): SourceLocation {
    const sf = node.getSourceFile();
    return {
      filePath: sf.getFilePath(),
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
    };
  }

  private makeNode(
    kind: ControlFlowKind,
    astNode: Node,
    children: readonly FlowNode[],
    metadata: FlowNodeMetadata = {},
  ): FlowNode {
    let finalMetadata = metadata;
    if (kind === 'leaf' && !metadata.calleeName && !metadata.functionName) {
      const raw = astNode.getText().replace(/\s+/g, ' ').trim();
      const label = raw.length > 50 ? raw.substring(0, 47) + '...' : raw;
      finalMetadata = { ...metadata, expressionLabel: label };
    }
    return {
      id: this.nextId(),
      kind,
      astNode,
      location: this.locationOf(astNode),
      children,
      metadata: finalMetadata,
    };
  }

  buildFunction(
    fn: AnalyzableFunction,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const body = fn.getBody();
    if (!body) {
      // No body (e.g. declaration-only) -> leaf
      return this.makeNode('leaf', fn, [], { isExternal: false });
    }

    // If the body is an expression (arrow function with expression body),
    // treat it as a single statement.
    if (!Node.isBlock(body)) {
      return this.visitNode(body, depth, callStack);
    }

    const prevNested = this.nestedFunctions;
    this.nestedFunctions = new Map(prevNested);
    for (const stmt of body.getStatements()) {
      if (Node.isFunctionDeclaration(stmt)) {
        const name = stmt.getName();
        if (name) {
          this.nestedFunctions.set(name, stmt);
        }
      }
    }

    const stmts = body.getStatements();
    if (stmts.length === 0) {
      this.nestedFunctions = prevNested;
      return this.makeNode('leaf', body, [], { isExternal: false });
    }

    const children = stmts
      .map((s) => this.visitNode(s, depth, callStack))
      .filter((c): c is FlowNode => c !== null);

    this.nestedFunctions = prevNested;

    if (children.length === 0) {
      return this.makeNode('leaf', body, [], { isExternal: false });
    }
    if (children.length === 1) {
      return children[0];
    }
    return this.makeNode('sequential', body, children);
  }

  private visitNode(
    node: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (Node.isFunctionDeclaration(node)) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }

    if (Node.isForOfStatement(node)) {
      return this.visitForOf(node, depth, callStack);
    }
    if (Node.isForInStatement(node)) {
      return this.visitForIn(node, depth, callStack);
    }
    if (Node.isForStatement(node)) {
      return this.visitForStmt(node, depth, callStack);
    }
    if (Node.isWhileStatement(node)) {
      return this.visitWhile(node, depth, callStack);
    }
    if (Node.isDoStatement(node)) {
      return this.visitDoWhile(node, depth, callStack);
    }

    if (Node.isIfStatement(node)) {
      return this.visitIf(node, depth, callStack);
    }
    if (Node.isSwitchStatement(node)) {
      return this.visitSwitch(node, depth, callStack);
    }

    if (Node.isBlock(node)) {
      return this.visitBlock(node, depth, callStack);
    }

    if (Node.isExpressionStatement(node)) {
      return this.visitNode(node.getExpression(), depth, callStack);
    }

    if (Node.isVariableStatement(node)) {
      return this.visitVariableStatement(node, depth, callStack);
    }

    if (Node.isReturnStatement(node)) {
      const expr = node.getExpression();
      if (expr) {
        return this.visitNode(expr, depth, callStack);
      }
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    if (Node.isThrowStatement(node)) {
      const expr = node.getExpression();
      if (expr) {
        return this.visitNode(expr, depth, callStack);
      }
      return this.makeNode('leaf', node, [], { isExternal: false });
    }

    if (Node.isConditionalExpression(node)) {
      return this.visitTernary(node, depth, callStack);
    }

    if (Node.isAwaitExpression(node)) {
      return this.visitNode(node.getExpression(), depth, callStack);
    }

    if (Node.isParenthesizedExpression(node)) {
      return this.visitNode(node.getExpression(), depth, callStack);
    }

    if (Node.isCallExpression(node)) {
      return this.visitCall(node, depth, callStack);
    }

    if (Node.isBinaryExpression(node)) {
      return this.visitBinaryExpression(node, depth, callStack);
    }

    if (Node.isArrayLiteralExpression(node)) {
      return this.visitArrayLiteral(node, depth, callStack);
    }

    if (Node.isSpreadElement(node)) {
      return this.visitNode(node.getExpression(), depth, callStack);
    }

    if (Node.isTryStatement(node)) {
      return this.visitTry(node, depth, callStack);
    }

    if (Node.isLabeledStatement(node)) {
      return this.visitNode(node.getStatement(), depth, callStack);
    }

    return this.makeNode('leaf', node, [], { isExternal: false });
  }

  private visitForOf(
    node: ForOfStatement,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const isAwait = node.getAwaitKeyword() !== undefined;
    const kind: ControlFlowKind = isAwait ? 'for-await' : 'loop';

    const loopVariable = this.extractForOfInVariable(node);
    const loopBound = this.extractForOfInBound(node);

    const bodyNode = this.visitLoopBody(node.getStatement(), depth, callStack);
    return this.makeNode(kind, node, [bodyNode], { loopVariable, loopBound });
  }

  private visitForIn(
    node: ForInStatement,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const loopVariable = this.extractForOfInVariable(node);
    const loopBound = this.extractForOfInBound(node);
    const bodyNode = this.visitLoopBody(node.getStatement(), depth, callStack);
    return this.makeNode('loop', node, [bodyNode], {
      loopVariable,
      loopBound,
    });
  }

  private visitForStmt(
    node: ForStatement,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const meta = this.extractForStatementMeta(node);
    const bodyNode = this.visitLoopBody(node.getStatement(), depth, callStack);
    return this.makeNode('loop', node, [bodyNode], meta);
  }

  private visitWhile(
    node: WhileStatement,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const bodyNode = this.visitLoopBody(node.getStatement(), depth, callStack);
    return this.makeNode('loop', node, [bodyNode]);
  }

  private visitDoWhile(
    node: DoStatement,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const bodyNode = this.visitLoopBody(node.getStatement(), depth, callStack);
    return this.makeNode('loop', node, [bodyNode]);
  }

  private visitLoopBody(
    stmt: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    return this.visitNode(stmt, depth, callStack);
  }


  private visitBinaryExpression(
    node: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (!Node.isBinaryExpression(node)) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    const left = this.visitNode(node.getLeft(), depth, callStack);
    const right = this.visitNode(node.getRight(), depth, callStack);

    if (
      left.kind === 'leaf' && !left.metadata.isExternal &&
      right.kind === 'leaf' && !right.metadata.isExternal
    ) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    if (left.kind === 'leaf' && !left.metadata.isExternal) return right;
    if (right.kind === 'leaf' && !right.metadata.isExternal) return left;

    return this.makeNode('sequential', node, [left, right]);
  }


  private visitArrayLiteral(
    node: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (!Node.isArrayLiteralExpression(node)) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    const elements = node.getElements();
    const children: FlowNode[] = [];
    for (const el of elements) {
      const child = this.visitNode(el, depth, callStack);
      children.push(child);
    }
    const meaningful = children.filter(
      (c) => !(c.kind === 'leaf' && !c.metadata.isExternal),
    );
    if (meaningful.length === 0) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    if (meaningful.length === 1) return meaningful[0];
    return this.makeNode('sequential', node, meaningful);
  }

  private visitIf(
    node: IfStatement,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const children: FlowNode[] = [];
    children.push(this.visitNode(node.getThenStatement(), depth, callStack));

    const elseStmt = node.getElseStatement();
    if (elseStmt) {
      children.push(this.visitNode(elseStmt, depth, callStack));
    }
    return this.makeNode('branch', node, children);
  }

  private visitSwitch(
    node: SwitchStatement,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const clauses = node.getClauses();
    const children: FlowNode[] = [];
    for (const clause of clauses) {
      const stmts = clause.getStatements();
      if (stmts.length === 0) continue;
      const stmtNodes = stmts.map((s) => this.visitNode(s, depth, callStack));
      if (stmtNodes.length === 1) {
        children.push(stmtNodes[0]);
      } else {
        children.push(
          this.makeNode('sequential', clause, stmtNodes),
        );
      }
    }
    if (children.length === 0) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    return this.makeNode('branch', node, children);
  }

  private visitTernary(
    node: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (!Node.isConditionalExpression(node)) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    const whenTrue = this.visitNode(node.getWhenTrue(), depth, callStack);
    const whenFalse = this.visitNode(node.getWhenFalse(), depth, callStack);
    return this.makeNode('branch', node, [whenTrue, whenFalse]);
  }



  private visitBlock(
    node: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (!Node.isBlock(node)) {
      return this.visitNode(node, depth, callStack);
    }
    const stmts = node.getStatements();
    if (stmts.length === 0) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    const children = stmts.map((s) => this.visitNode(s, depth, callStack));
    if (children.length === 1) return children[0];
    return this.makeNode('sequential', node, children);
  }


  private visitVariableStatement(
    node: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (!Node.isVariableStatement(node)) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    const decls = node.getDeclarations();
    const children: FlowNode[] = [];
    for (const d of decls) {
      const init = d.getInitializer();
      if (init) {
        const child = this.visitNode(init, depth, callStack);
        children.push(child);
      }
    }
    if (children.length === 0) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    if (children.length === 1) return children[0];
    return this.makeNode('sequential', node, children);
  }


  private visitTry(
    node: Node,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (!Node.isTryStatement(node)) {
      return this.makeNode('leaf', node, [], { isExternal: false });
    }
    const children: FlowNode[] = [];
    const tryBlock = node.getTryBlock();
    children.push(this.visitBlock(tryBlock, depth, callStack));

    const catchClause = node.getCatchClause();
    if (catchClause) {
      children.push(this.visitBlock(catchClause.getBlock(), depth, callStack));
    }

    const finallyBlock = node.getFinallyBlock();
    if (finallyBlock) {
      children.push(this.visitBlock(finallyBlock, depth, callStack));
    }

    if (children.length === 1) return children[0];
    return this.makeNode('sequential', node, children);
  }


  private visitCall(
    node: CallExpression,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    if (this.isPromiseAll(node)) {
      return this.visitPromiseAll(node, depth, callStack);
    }

    const calleeName = this.getCalleeName(node);
    let target = resolveCallTarget(node);

    if (!target && calleeName) {
      const nested = this.nestedFunctions.get(calleeName);
      if (nested) {
        target = nested;
      }
    }

    if (!target) {
      return this.makeNode('leaf', node, [], {
        isExternal: true,
        calleeName: calleeName ?? undefined,
      });
    }

    if (callStack.has(target)) {
      const shrink = this.detectShrinkPattern(node);
      return this.makeNode('recursion', node, [], {
        calleeName: getFunctionName(target),
        recursionShrink: shrink,
      });
    }

    if (depth >= this.maxInlineDepth) {
      return this.makeNode('leaf', node, [], {
        isExternal: true,
        calleeName: getFunctionName(target),
      });
    }

    const newStack = new Set(callStack);
    newStack.add(target);
    const inlined = this.buildFunction(target, depth + 1, newStack);
    return inlined;
  }

  private isPromiseAll(node: CallExpression): boolean {
    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return false;
    const propName = expr.getName();
    if (propName !== 'all') return false;
    const obj = expr.getExpression();
    return Node.isIdentifier(obj) && obj.getText() === 'Promise';
  }

  private visitPromiseAll(
    node: CallExpression,
    depth: number,
    callStack: Set<AnalyzableFunction>,
  ): FlowNode {
    const args = node.getArguments();
    const children: FlowNode[] = [];

    if (args.length > 0) {
      const firstArg = args[0];
      if (Node.isArrayLiteralExpression(firstArg)) {
        for (const element of firstArg.getElements()) {
          children.push(this.visitNode(element, depth, callStack));
        }
      } else {
        children.push(this.visitNode(firstArg, depth, callStack));
      }
    }

    return this.makeNode('async-parallel', node, children);
  }

  private getCalleeName(node: CallExpression): string | null {
    const expr = node.getExpression();
    if (Node.isIdentifier(expr)) {
      return expr.getText();
    }
    if (Node.isPropertyAccessExpression(expr)) {
      return expr.getText();
    }
    return null;
  }


  private detectShrinkPattern(
    call: CallExpression,
  ): RecursionShrinkPattern {
    const args = call.getArguments();
    for (const arg of args) {
      const text = arg.getText().trim();

      if (
        /^Math\.(floor|ceil)\(.+\/\s*2\)$/.test(text) ||
        /^.+\/\s*2$/.test(text)
      ) {
        return 'halving';
      }

      if (
        /^.+\s*-\s*\d+$/.test(text) ||
        /^.+\.slice\(\d+\)$/.test(text)
      ) {
        return 'linear';
      }
    }
    return 'unknown';
  }


  private extractForOfInVariable(node: ForOfStatement | ForInStatement): string | undefined {
    const initializer = node.getInitializer();
    if (Node.isVariableDeclarationList(initializer)) {
      const decls = initializer.getDeclarations();
      if (decls.length > 0) return decls[0].getName();
    }
    return initializer.getText();
  }

  private extractForOfInBound(node: ForOfStatement | ForInStatement): string | undefined {
    return node.getExpression().getText();
  }

  private extractForStatementMeta(
    node: ForStatement,
  ): FlowNodeMetadata {
    const initializer = node.getInitializer();
    let loopVariable: string | undefined;

    // Collect variable initializers to resolve bound aliases (e.g. len = arr.length)
    const initializerAliases = new Map<string, string>();
    if (initializer && Node.isVariableDeclarationList(initializer)) {
      const decls = initializer.getDeclarations();
      if (decls.length > 0) loopVariable = decls[0].getName();
      for (const decl of decls) {
        const init = decl.getInitializer();
        if (init) {
          initializerAliases.set(decl.getName(), init.getText());
        }
      }
    }

    // Try to extract bound from the condition: i < n, i < arr.length, etc.
    let loopBound: string | undefined;
    const condition = node.getCondition();
    if (condition) {
      const condText = condition.getText();
      const match = condText.match(/^\w+\s*<[=]?\s*(.+)$/);
      if (match) {
        const rawBound = match[1].trim();
        // Resolve alias: if bound is a variable initialized from an expression, use that expression
        loopBound = initializerAliases.get(rawBound) ?? rawBound;
      }
    }

    return { loopVariable, loopBound };
  }
}
