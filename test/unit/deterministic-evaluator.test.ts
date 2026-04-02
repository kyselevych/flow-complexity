import { describe, it, expect } from 'vitest';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { matchPattern } from '../../src/evaluators/deterministic/patterns.js';
import { analyzeLoopBounds } from '../../src/evaluators/deterministic/loop-analyzer.js';
import { analyzeRecursion } from '../../src/evaluators/deterministic/recursion-detector.js';
import { analyzeAsyncPattern } from '../../src/evaluators/deterministic/async-analyzer.js';
import { BigOClass } from '../../src/types/complexity.js';
import type { FlowNode } from '../../src/types/flow-graph.js';

function createProject() {
  return new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
}

function makeFlowNode(source: string, functionName = 'fn', calleeName?: string): FlowNode {
  const project = createProject();
  const sf = project.createSourceFile('test.ts', source);
  const fn = sf.getFunctionOrThrow(functionName);

  return {
    id: 'test-node',
    kind: 'leaf',
    astNode: fn,
    location: { filePath: 'test.ts', startLine: 1, endLine: 99 },
    children: [],
    metadata: {
      functionName,
      calleeName,
    },
  };
}

function extractFirstLoop(source: string, fnName = 'fn'): Node {
  const project = createProject();
  const sf = project.createSourceFile('test.ts', source);
  const fn = sf.getFunctionOrThrow(fnName);

  let loopNode: Node | undefined;
  fn.forEachDescendant((child, traversal) => {
    if (loopNode) return;
    const kind = child.getKind();
    if (
      kind === SyntaxKind.ForStatement ||
      kind === SyntaxKind.ForOfStatement ||
      kind === SyntaxKind.ForInStatement ||
      kind === SyntaxKind.WhileStatement ||
      kind === SyntaxKind.DoStatement
    ) {
      loopNode = child;
      traversal.stop();
    }
  });

  if (!loopNode) throw new Error('No loop found in source');
  return loopNode;
}

function extractFunction(source: string, fnName = 'fn'): Node {
  const project = createProject();
  const sf = project.createSourceFile('test.ts', source);
  return sf.getFunctionOrThrow(fnName);
}

describe('matchPattern — constant (O(1))', () => {
  it('returns O(1) for a function with no loops and no calls', () => {
    const node = makeFlowNode(`function fn(x: number): number { return x + 1; }`);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.pattern).toBe('constant');
    expect(match!.result.complexity.class).toBe(BigOClass.O1);
    expect(match!.result.confidence).toBe(1.0);
    expect(match!.result.source).toBe('deterministic');
  });

  it('returns O(1) for a function that only returns a literal', () => {
    const node = makeFlowNode(`function fn(): number { return 42; }`);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.O1);
  });

  it('returns O(1) for a function with only if/else and no loops', () => {
    const node = makeFlowNode(`
      function fn(x: number): string {
        if (x > 0) return 'pos';
        else if (x < 0) return 'neg';
        return 'zero';
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.O1);
  });
});

describe('matchPattern — single loop (O(n))', () => {
  it('returns O(n) for a simple for loop', () => {
    const node = makeFlowNode(`
      function fn(arr: number[]): void {
        for (let i = 0; i < arr.length; i++) {
          console.log(arr[i]);
        }
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.pattern).toBe('single-loop');
    expect(match!.result.complexity.class).toBe(BigOClass.ON);
    expect(match!.result.confidence).toBe(1.0);
  });

  it('returns O(n) for a for-of loop', () => {
    const node = makeFlowNode(`
      function fn(items: string[]): void {
        for (const item of items) {
          process(item);
        }
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.ON);
  });

  it('returns O(n) for a while loop', () => {
    const node = makeFlowNode(`
      function fn(n: number): void {
        let i = 0;
        while (i < n) {
          i++;
        }
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.ON);
  });
});

describe('matchPattern — nested loops (O(n²))', () => {
  it('returns O(n²) for two nested for loops', () => {
    const node = makeFlowNode(`
      function fn(n: number): void {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            doWork(i, j);
          }
        }
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.pattern).toBe('nested-loops-2');
    expect(match!.result.complexity.class).toBe(BigOClass.ON2);
    expect(match!.result.confidence).toBe(1.0);
  });

  it('returns O(n³) for three-deep nested loops', () => {
    const node = makeFlowNode(`
      function fn(n: number): void {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            for (let k = 0; k < n; k++) {
              doWork(i, j, k);
            }
          }
        }
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.ON3);
    expect(match!.result.confidence).toBe(1.0);
  });
});

describe('matchPattern — halving loop (O(log n))', () => {
  it('returns O(log n) for while loop with n /= 2', () => {
    const node = makeFlowNode(`
      function fn(n: number): number {
        let count = 0;
        while (n > 0) {
          n /= 2;
          count++;
        }
        return count;
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.pattern).toBe('halving-loop');
    expect(match!.result.complexity.class).toBe(BigOClass.OLogN);
    expect(match!.result.confidence).toBe(1.0);
  });

  it('returns O(log n) for loop with i *= 2', () => {
    const node = makeFlowNode(`
      function fn(n: number): number {
        let count = 0;
        for (let i = 1; i < n; i *= 2) {
          count++;
        }
        return count;
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.OLogN);
  });

  it('returns O(log n) for loop with n >>= 1', () => {
    const node = makeFlowNode(`
      function fn(n: number): number {
        let count = 0;
        while (n > 0) {
          n >>= 1;
          count++;
        }
        return count;
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.OLogN);
  });
});

describe('matchPattern — sort call (O(n log n))', () => {
  it('returns O(n log n) for arr.sort()', () => {
    const node = makeFlowNode(`
      function fn(arr: number[]): number[] {
        return arr.sort((a, b) => a - b);
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.pattern).toBe('sort-call');
    expect(match!.result.complexity.class).toBe(BigOClass.ONLogN);
    expect(match!.result.confidence).toBe(1.0);
  });

  it('returns O(n log n) for arr.sort() without comparator', () => {
    const node = makeFlowNode(`
      function fn(items: string[]): string[] {
        items.sort();
        return items;
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.ONLogN);
  });
});

describe('matchPattern — Map.get call (O(1))', () => {
  it('returns O(1) for map.get()', () => {
    const node = makeFlowNode(`
      function fn(map: Map<string, number>, key: string): number | undefined {
        return map.get(key);
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.pattern).toBe('builtin-call');
    expect(match!.result.complexity.class).toBe(BigOClass.O1);
    expect(match!.result.confidence).toBe(1.0);
  });

  it('returns O(1) for map.set()', () => {
    const node = makeFlowNode(`
      function fn(map: Map<string, number>, key: string, val: number): void {
        map.set(key, val);
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.O1);
  });

  it('returns O(1) for map.has()', () => {
    const node = makeFlowNode(`
      function fn(map: Map<string, number>, key: string): boolean {
        return map.has(key);
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeDefined();
    expect(match!.result.complexity.class).toBe(BigOClass.O1);
  });
});

describe('analyzeLoopBounds', () => {
  it('extracts variable and bound from for loop', () => {
    const loop = extractFirstLoop(`
      function fn(n: number): void {
        for (let i = 0; i < n; i++) {}
      }
    `);
    const bounds = analyzeLoopBounds(loop);
    expect(bounds.variable).toBe('i');
    expect(bounds.bound).toBe('n');
    expect(bounds.isHalving).toBe(false);
    expect(bounds.isInputDependent).toBe(true);
  });

  it('extracts variable and bound from for-of loop', () => {
    const loop = extractFirstLoop(`
      function fn(items: string[]): void {
        for (const item of items) {}
      }
    `);
    const bounds = analyzeLoopBounds(loop);
    expect(bounds.variable).toBe('item');
    expect(bounds.bound).toBe('items');
    expect(bounds.isInputDependent).toBe(true);
  });

  it('detects isHalving = true for n /= 2', () => {
    const loop = extractFirstLoop(`
      function fn(n: number): void {
        while (n > 0) {
          n /= 2;
        }
      }
    `);
    const bounds = analyzeLoopBounds(loop);
    expect(bounds.isHalving).toBe(true);
  });

  it('detects isHalving = true for i *= 2', () => {
    const loop = extractFirstLoop(`
      function fn(n: number): void {
        for (let i = 1; i < n; i *= 2) {}
      }
    `);
    const bounds = analyzeLoopBounds(loop);
    expect(bounds.isHalving).toBe(true);
  });

  it('detects isHalving = true for n >>= 1', () => {
    const loop = extractFirstLoop(`
      function fn(n: number): void {
        while (n > 0) { n >>= 1; }
      }
    `);
    const bounds = analyzeLoopBounds(loop);
    expect(bounds.isHalving).toBe(true);
  });

  it('isInputDependent = false for constant bound', () => {
    const loop = extractFirstLoop(`
      function fn(): void {
        for (let i = 0; i < 10; i++) {}
      }
    `);
    const bounds = analyzeLoopBounds(loop);
    expect(bounds.bound).toBe('10');
    expect(bounds.isInputDependent).toBe(false);
  });
});

describe('analyzeRecursion', () => {
  it('detects linear recursion with n-1', () => {
    const fn = extractFunction(`
      function fn(n: number): number {
        if (n <= 0) return 0;
        return fn(n - 1) + 1;
      }
    `);
    const info = analyzeRecursion(fn, 'fn');
    expect(info.shrinkPattern).toBe('linear');
    expect(info.recursiveCallCount).toBe(1);
  });

  it('detects linear recursion with arr.slice(1)', () => {
    const fn = extractFunction(`
      function fn(arr: number[]): number {
        if (arr.length === 0) return 0;
        return 1 + fn(arr.slice(1));
      }
    `);
    const info = analyzeRecursion(fn, 'fn');
    expect(info.shrinkPattern).toBe('linear');
    expect(info.recursiveCallCount).toBe(1);
  });

  it('detects halving recursion with n/2', () => {
    const fn = extractFunction(`
      function fn(n: number): number {
        if (n <= 1) return 1;
        return fn(n/2) + fn(n/2);
      }
    `);
    const info = analyzeRecursion(fn, 'fn');
    expect(info.shrinkPattern).toBe('halving');
    expect(info.recursiveCallCount).toBe(2);
  });

  it('detects halving recursion with Math.floor(n/2)', () => {
    const fn = extractFunction(`
      function fn(n: number): number {
        if (n <= 1) return n;
        return fn(Math.floor(n/2));
      }
    `);
    const info = analyzeRecursion(fn, 'fn');
    expect(info.shrinkPattern).toBe('halving');
  });

  it('returns unknown for non-recursive function', () => {
    const fn = extractFunction(`
      function fn(n: number): number {
        return n * 2;
      }
    `);
    const info = analyzeRecursion(fn, 'fn');
    expect(info.recursiveCallCount).toBe(0);
    expect(info.shrinkPattern).toBe('unknown');
  });

  it('counts multiple recursive calls', () => {
    const fn = extractFunction(`
      function fn(n: number): number {
        if (n <= 0) return 0;
        return fn(n-1) + fn(n-1) + fn(n-1);
      }
    `);
    const info = analyzeRecursion(fn, 'fn');
    expect(info.recursiveCallCount).toBe(3);
    expect(info.shrinkPattern).toBe('linear');
  });
});

describe('analyzeAsyncPattern', () => {
  it('detects Promise.all as parallel', () => {
    const fn = extractFunction(`
      async function fn(urls: string[]): Promise<string[]> {
        return await Promise.all(urls.map(u => fetch(u).then(r => r.text())));
      }
    `);
    const pattern = analyzeAsyncPattern(fn);
    expect(pattern).toBe('parallel');
  });

  it('detects for-await as for-await', () => {
    const fn = extractFunction(`
      async function fn(stream: AsyncIterable<number>): Promise<void> {
        for await (const chunk of stream) {
          process(chunk);
        }
      }
    `);
    const pattern = analyzeAsyncPattern(fn);
    expect(pattern).toBe('for-await');
  });

  it('detects multiple sequential awaits as sequential', () => {
    const fn = extractFunction(`
      async function fn(): Promise<void> {
        const a = await fetchA();
        const b = await fetchB();
        return combine(a, b);
      }
    `);
    const pattern = analyzeAsyncPattern(fn);
    expect(pattern).toBe('sequential');
  });

  it('returns none for synchronous function', () => {
    const fn = extractFunction(`
      function fn(x: number): number {
        return x * 2;
      }
    `);
    const pattern = analyzeAsyncPattern(fn);
    expect(pattern).toBe('none');
  });

  it('returns none for async function with single await', () => {
    const fn = extractFunction(`
      async function fn(url: string): Promise<string> {
        return await fetch(url).then(r => r.text());
      }
    `);
    const pattern = analyzeAsyncPattern(fn);
    expect(pattern).toBe('none');
  });

  it('Promise.all takes priority over sequential pattern', () => {
    const fn = extractFunction(`
      async function fn(urls: string[]): Promise<string[]> {
        const headers = await getHeaders();
        return Promise.all(urls.map(u => fetch(u, headers)));
      }
    `);
    const pattern = analyzeAsyncPattern(fn);
    expect(pattern).toBe('parallel');
  });
});

describe('matchPattern — unknown (no match)', () => {
  it('returns undefined for a recursive function with unclear pattern', () => {
    const node = makeFlowNode(`
      function fn(n: number): number {
        if (n <= 0) return 0;
        return fn(n - 1) + fn(n - 2);  // Fibonacci — doesn't map to any simple pattern
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeUndefined();
  });

  it('returns undefined for a function with self-recursion and no loops', () => {
    const node = makeFlowNode(`
      function fn(n: number): number {
        return n <= 1 ? 1 : fn(n - 1) * n;
      }
    `);
    const match = matchPattern(node);
    expect(match).toBeUndefined();
  });
});
