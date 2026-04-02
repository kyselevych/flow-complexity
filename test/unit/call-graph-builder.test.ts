import { describe, it, expect } from 'vitest';
import { Project, Node } from 'ts-morph';
import {
  createCallGraphBuilder,
  CallGraphBuilder,
} from '../../src/pipeline/call-graph-builder.js';
import { ScanResult } from '../../src/pipeline/scanner.js';
import { AnalyzableFunction, getFunctionName } from '../../src/util/ast-helpers.js';
import { FlowNode } from '../../src/types/flow-graph.js';

function createProject() {
  return new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
}

function makeScanResult(
  project: Project,
  fileName: string,
  fnName: string,
): ScanResult {
  const sf = project.getSourceFileOrThrow(fileName);
  const fn = sf.getFunctionOrThrow(fnName);
  return {
    functionName: fnName,
    filePath: sf.getFilePath(),
    location: {
      filePath: sf.getFilePath(),
      startLine: fn.getStartLineNumber(),
      endLine: fn.getEndLineNumber(),
    },
    astNode: fn,
  };
}

function makeScanResultArrow(
  project: Project,
  fileName: string,
  varName: string,
): ScanResult {
  const sf = project.getSourceFileOrThrow(fileName);
  const varDecl = sf.getVariableDeclarationOrThrow(varName);
  const init = varDecl.getInitializerOrThrow();
  return {
    functionName: varName,
    filePath: sf.getFilePath(),
    location: {
      filePath: sf.getFilePath(),
      startLine: init.getStartLineNumber(),
      endLine: init.getEndLineNumber(),
    },
    astNode: init as AnalyzableFunction,
  };
}

function buildTree(
  code: string,
  fnName: string,
  maxInlineDepth = 3,
): FlowNode {
  const project = createProject();
  project.createSourceFile('test.ts', code);
  const builder = createCallGraphBuilder({ project, maxInlineDepth });
  const scan = makeScanResult(project, 'test.ts', fnName);
  return builder.buildFlowTree(scan).flowTree;
}

function buildTreeArrow(
  code: string,
  varName: string,
  maxInlineDepth = 3,
): FlowNode {
  const project = createProject();
  project.createSourceFile('test.ts', code);
  const builder = createCallGraphBuilder({ project, maxInlineDepth });
  const scan = makeScanResultArrow(project, 'test.ts', varName);
  return builder.buildFlowTree(scan).flowTree;
}

function collectKinds(node: FlowNode): string[] {
  const result: string[] = [node.kind];
  for (const child of node.children) {
    result.push(...collectKinds(child));
  }
  return result;
}

function findByKind(root: FlowNode, kind: string): FlowNode | undefined {
  if (root.kind === kind) return root;
  for (const child of root.children) {
    const found = findByKind(child, kind);
    if (found) return found;
  }
  return undefined;
}

function findAllByKind(root: FlowNode, kind: string): FlowNode[] {
  const result: FlowNode[] = [];
  if (root.kind === kind) result.push(root);
  for (const child of root.children) {
    result.push(...findAllByKind(child, kind));
  }
  return result;
}

describe('CallGraphBuilder', () => {
  describe('simple function (no loops/calls)', () => {
    it('produces a leaf for an empty function', () => {
      const tree = buildTree('function empty() {}', 'empty');
      expect(tree.kind).toBe('leaf');
      expect(tree.children).toHaveLength(0);
    });

    it('produces a leaf for a single return', () => {
      const tree = buildTree('function one() { return 42; }', 'one');
      expect(tree.kind).toBe('leaf');
    });

    it('produces sequential for multiple statements', () => {
      const tree = buildTree(
        `function multi() {
          const a = 1;
          const b = 2;
          return a + b;
        }`,
        'multi',
      );
      expect(tree.kind).toBe('sequential');
      expect(tree.children.length).toBeGreaterThanOrEqual(2);
    });

    it('flattens a block with a single child', () => {
      const tree = buildTree(
        `function single() { const x = 1; }`,
        'single',
      );
      expect(tree.kind).toBe('leaf');
    });
  });

  describe('single for-of loop', () => {
    it('produces a loop node', () => {
      const tree = buildTree(
        `function loopFn(items: string[]) {
          for (const item of items) {
            console.log(item);
          }
        }`,
        'loopFn',
      );
      expect(tree.kind).toBe('loop');
    });

    it('extracts loopVariable and loopBound', () => {
      const tree = buildTree(
        `function loopFn(items: string[]) {
          for (const x of items) {
            console.log(x);
          }
        }`,
        'loopFn',
      );
      expect(tree.metadata.loopVariable).toBe('x');
      expect(tree.metadata.loopBound).toBe('items');
    });

    it('has children representing the loop body', () => {
      const tree = buildTree(
        `function loopFn(items: string[]) {
          for (const x of items) {
            const a = 1;
          }
        }`,
        'loopFn',
      );
      expect(tree.children.length).toBe(1);
    });
  });

  describe('nested loops', () => {
    it('produces loop containing loop', () => {
      const tree = buildTree(
        `function nested(matrix: number[][]) {
          for (const row of matrix) {
            for (const cell of row) {
              console.log(cell);
            }
          }
        }`,
        'nested',
      );
      expect(tree.kind).toBe('loop');
      expect(tree.metadata.loopVariable).toBe('row');
      expect(tree.metadata.loopBound).toBe('matrix');

      expect(tree.children[0].kind).toBe('loop');
      expect(tree.children[0].metadata.loopVariable).toBe('cell');
      expect(tree.children[0].metadata.loopBound).toBe('row');
    });

    it('handles for-statement with condition-based bound', () => {
      const tree = buildTree(
        `function classic(arr: number[]) {
          for (let i = 0; i < arr.length; i++) {
            const x = arr[i];
          }
        }`,
        'classic',
      );
      expect(tree.kind).toBe('loop');
      expect(tree.metadata.loopVariable).toBe('i');
      expect(tree.metadata.loopBound).toBe('arr.length');
    });
  });

  describe('if/else branching', () => {
    it('produces branch node with 2 children for if/else', () => {
      const tree = buildTree(
        `function branchy(x: number) {
          if (x > 0) {
            return x;
          } else {
            return -x;
          }
        }`,
        'branchy',
      );
      expect(tree.kind).toBe('branch');
      expect(tree.children).toHaveLength(2);
    });

    it('produces branch node with 1 child for if without else', () => {
      const tree = buildTree(
        `function ifOnly(x: number) {
          if (x > 0) {
            return x;
          }
        }`,
        'ifOnly',
      );
      expect(tree.kind).toBe('branch');
      expect(tree.children).toHaveLength(1);
    });

    it('handles ternary as branch with 2 children', () => {
      const tree = buildTree(
        `function ternary(x: number) {
          return x > 0 ? x : -x;
        }`,
        'ternary',
      );
      expect(tree.kind).toBe('branch');
      expect(tree.children).toHaveLength(2);
    });

    it('produces branch for switch statement', () => {
      const tree = buildTree(
        `function sw(x: number) {
          switch (x) {
            case 1:
              return 'one';
            case 2:
              return 'two';
            default:
              return 'other';
          }
        }`,
        'sw',
      );
      expect(tree.kind).toBe('branch');
      expect(tree.children).toHaveLength(3);
    });
  });

  describe('function call (local, inlined)', () => {
    it('inlines a local function call', () => {
      const tree = buildTree(
        `function main() {
          helper();
        }
        function helper() {
          const x = 1;
          const y = 2;
        }`,
        'main',
      );
      expect(tree.kind).toBe('sequential');
    });

    it('inlines a loop from a callee', () => {
      const tree = buildTree(
        `function main(items: string[]) {
          process(items);
        }
        function process(data: string[]) {
          for (const d of data) {
            console.log(d);
          }
        }`,
        'main',
      );
      const loopNode = findByKind(tree, 'loop');
      expect(loopNode).toBeDefined();
    });

    it('inlines nested calls up to maxInlineDepth', () => {
      const tree = buildTree(
        `function a() { b(); }
         function b() { c(); }
         function c() { const x = 1; }`,
        'a',
        3,
      );
      expect(tree.kind).toBe('leaf');
    });
  });

  describe('function call (external/unresolvable)', () => {
    it('produces leaf with isExternal for unresolvable call', () => {
      const tree = buildTree(
        `function main() {
          someExternalFn();
        }`,
        'main',
      );
      expect(tree.kind).toBe('leaf');
      expect(tree.metadata.isExternal).toBe(true);
      expect(tree.metadata.calleeName).toBe('someExternalFn');
    });

    it('produces leaf for method calls on objects', () => {
      const tree = buildTree(
        `function main() {
          console.log('hello');
        }`,
        'main',
      );
      expect(tree.kind).toBe('leaf');
      expect(tree.metadata.isExternal).toBe(true);
    });
  });

  describe('Promise.all', () => {
    it('produces async-parallel node', () => {
      const tree = buildTree(
        `function main() {
          Promise.all([fetch('a'), fetch('b'), fetch('c')]);
        }`,
        'main',
      );
      expect(tree.kind).toBe('async-parallel');
    });

    it('has one child per array element', () => {
      const tree = buildTree(
        `function main() {
          Promise.all([fetch('a'), fetch('b')]);
        }`,
        'main',
      );
      expect(tree.kind).toBe('async-parallel');
      expect(tree.children).toHaveLength(2);
    });

    it('children are leaf nodes for unresolvable calls', () => {
      const tree = buildTree(
        `function main() {
          Promise.all([fetch('a'), fetch('b')]);
        }`,
        'main',
      );
      for (const child of tree.children) {
        expect(child.kind).toBe('leaf');
        expect(child.metadata.isExternal).toBe(true);
      }
    });
  });

  describe('for-await', () => {
    it('produces for-await node', () => {
      const tree = buildTree(
        `async function main(stream: AsyncIterable<string>) {
          for await (const chunk of stream) {
            console.log(chunk);
          }
        }`,
        'main',
      );
      expect(tree.kind).toBe('for-await');
      expect(tree.metadata.loopVariable).toBe('chunk');
      expect(tree.metadata.loopBound).toBe('stream');
    });

    it('has children from the loop body', () => {
      const tree = buildTree(
        `async function main(stream: AsyncIterable<string>) {
          for await (const chunk of stream) {
            const x = 1;
          }
        }`,
        'main',
      );
      expect(tree.kind).toBe('for-await');
      expect(tree.children).toHaveLength(1);
    });
  });

  describe('recursion detection', () => {
    it('detects direct recursion', () => {
      const tree = buildTree(
        `function fib(n: number): number {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 1);
        }`,
        'fib',
      );
      const recursions = findAllByKind(tree, 'recursion');
      expect(recursions.length).toBeGreaterThanOrEqual(1);
    });

    it('detects linear shrink: n - 1', () => {
      const tree = buildTree(
        `function countdown(n: number): number {
          if (n <= 0) return 0;
          return countdown(n - 1);
        }`,
        'countdown',
      );
      const rec = findByKind(tree, 'recursion');
      expect(rec).toBeDefined();
      expect(rec!.metadata.recursionShrink).toBe('linear');
    });

    it('detects halving shrink: Math.floor(n / 2)', () => {
      const tree = buildTree(
        `function halve(n: number): number {
          if (n <= 1) return n;
          return halve(Math.floor(n / 2));
        }`,
        'halve',
      );
      const rec = findByKind(tree, 'recursion');
      expect(rec).toBeDefined();
      expect(rec!.metadata.recursionShrink).toBe('halving');
    });

    it('detects halving shrink: n / 2', () => {
      const tree = buildTree(
        `function halve(n: number): number {
          if (n <= 1) return n;
          return halve(n / 2);
        }`,
        'halve',
      );
      const rec = findByKind(tree, 'recursion');
      expect(rec).toBeDefined();
      expect(rec!.metadata.recursionShrink).toBe('halving');
    });

    it('detects linear shrink: arr.slice(1)', () => {
      const tree = buildTree(
        `function process(arr: number[]): number {
          if (arr.length === 0) return 0;
          return process(arr.slice(1));
        }`,
        'process',
      );
      const rec = findByKind(tree, 'recursion');
      expect(rec).toBeDefined();
      expect(rec!.metadata.recursionShrink).toBe('linear');
    });

    it('returns unknown for unrecognized shrink', () => {
      const tree = buildTree(
        `function mystery(s: string): number {
          if (s.length === 0) return 0;
          return mystery(s.replace('a', ''));
        }`,
        'mystery',
      );
      const rec = findByKind(tree, 'recursion');
      expect(rec).toBeDefined();
      expect(rec!.metadata.recursionShrink).toBe('unknown');
    });

    it('sets calleeName on recursion node', () => {
      const tree = buildTree(
        `function fib(n: number): number {
          if (n <= 1) return n;
          return fib(n - 1);
        }`,
        'fib',
      );
      const rec = findByKind(tree, 'recursion');
      expect(rec).toBeDefined();
      expect(rec!.metadata.calleeName).toBe('fib');
    });
  });

  describe('max inline depth', () => {
    it('stops inlining at maxInlineDepth and produces a leaf', () => {
      const tree = buildTree(
        `function a() { b(); }
         function b() { c(); }
         function c() { d(); }
         function d() { const x = 1; }`,
        'a',
        2, // maxInlineDepth = 2
      );
      const leafs = findAllByKind(tree, 'leaf');
      const dLeaf = leafs.find((n) => n.metadata.calleeName === 'd');
      expect(dLeaf).toBeDefined();
      expect(dLeaf!.metadata.isExternal).toBe(true);
    });

    it('inlines fully when within depth', () => {
      const tree = buildTree(
        `function a() { b(); }
         function b() { const x = 1; }`,
        'a',
        3,
      );
      expect(tree.kind).toBe('leaf');
      expect(tree.metadata.isExternal).toBeFalsy();
    });
  });

  describe('edge cases', () => {
    it('handles while loop', () => {
      const tree = buildTree(
        `function whileFn() {
          let i = 0;
          while (i < 10) { i++; }
        }`,
        'whileFn',
      );
      const loopNode = findByKind(tree, 'loop');
      expect(loopNode).toBeDefined();
    });

    it('handles do-while loop', () => {
      const tree = buildTree(
        `function doWhileFn() {
          let i = 0;
          do { i++; } while (i < 10);
        }`,
        'doWhileFn',
      );
      const loopNode = findByKind(tree, 'loop');
      expect(loopNode).toBeDefined();
    });

    it('handles for-in loop', () => {
      const tree = buildTree(
        `function forInFn(obj: Record<string, number>) {
          for (const key in obj) {
            console.log(key);
          }
        }`,
        'forInFn',
      );
      expect(tree.kind).toBe('loop');
      expect(tree.metadata.loopVariable).toBe('key');
      expect(tree.metadata.loopBound).toBe('obj');
    });

    it('generates unique sequential IDs', () => {
      const tree = buildTree(
        `function multi() {
          const a = 1;
          const b = 2;
          const c = 3;
        }`,
        'multi',
      );
      const ids: string[] = [];
      function collectIds(n: FlowNode) {
        ids.push(n.id);
        for (const c of n.children) collectIds(c);
      }
      collectIds(tree);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
      for (const id of ids) {
        expect(id).toMatch(/^node_\d+$/);
      }
    });

    it('handles arrow function with expression body', () => {
      const tree = buildTreeArrow(
        `const add = (a: number, b: number) => a + b;`,
        'add',
      );
      expect(tree.kind).toBe('leaf');
    });

    it('handles await expression by unwrapping', () => {
      const tree = buildTree(
        `async function main() {
          await fetch('url');
        }`,
        'main',
      );
      expect(tree.kind).toBe('leaf');
      expect(tree.metadata.isExternal).toBe(true);
    });

    it('buildFlowTree returns correct AnalysisTarget fields', () => {
      const project = createProject();
      project.createSourceFile(
        'target.ts',
        `function myFn() { const x = 1; }`,
      );
      const builder = createCallGraphBuilder({ project, maxInlineDepth: 3 });
      const scan = makeScanResult(project, 'target.ts', 'myFn');
      const target = builder.buildFlowTree(scan);

      expect(target.functionName).toBe('myFn');
      expect(target.filePath).toContain('target.ts');
      expect(target.flowTree).toBeDefined();
      expect(target.location.startLine).toBeGreaterThan(0);
    });

    it('resets node IDs across buildFlowTree calls', () => {
      const project = createProject();
      project.createSourceFile(
        'a.ts',
        `function fn1() { const x = 1; }
         function fn2() { const y = 2; }`,
      );
      const builder = createCallGraphBuilder({ project, maxInlineDepth: 3 });

      const t1 = builder.buildFlowTree(makeScanResult(project, 'a.ts', 'fn1'));
      const t2 = builder.buildFlowTree(makeScanResult(project, 'a.ts', 'fn2'));

      expect(t1.flowTree.id).toBe('node_1');
      expect(t2.flowTree.id).toBe('node_1');
    });

    it('handles try/catch', () => {
      const tree = buildTree(
        `function tryCatch() {
          try {
            const x = 1;
          } catch (e) {
            const y = 2;
          }
        }`,
        'tryCatch',
      );
      expect(tree.kind).toBe('sequential');
      expect(tree.children).toHaveLength(2);
    });

    it('handles loop with multiple body statements', () => {
      const tree = buildTree(
        `function loopMulti(items: string[]) {
          for (const item of items) {
            const a = 1;
            const b = 2;
          }
        }`,
        'loopMulti',
      );
      expect(tree.kind).toBe('loop');
      expect(tree.children[0].kind).toBe('sequential');
      expect(tree.children[0].children).toHaveLength(2);
    });

    it('handles mixed loops and branches', () => {
      const tree = buildTree(
        `function mixed(items: number[]) {
          for (const item of items) {
            if (item > 0) {
              console.log(item);
            } else {
              console.log(-item);
            }
          }
        }`,
        'mixed',
      );
      expect(tree.kind).toBe('loop');
      const branchNode = findByKind(tree, 'branch');
      expect(branchNode).toBeDefined();
      expect(branchNode!.children).toHaveLength(2);
    });
  });
});
