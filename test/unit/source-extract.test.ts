import { describe, it, expect } from 'vitest';
import { Project, Node } from 'ts-morph';
import { extractFunctionSource, extractCallerContext } from '../../src/util/source-extract.js';
import { AnalyzableFunction } from '../../src/util/ast-helpers.js';

function createProject() {
  return new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
}

describe('extractFunctionSource', () => {
  it('returns function source for simple FunctionDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function foo(x: number): number { return x + 1; }`);
    const fn = sf.getFunctionOrThrow('foo');
    const src = extractFunctionSource(fn);
    expect(src).toContain('function foo');
    expect(src).toContain('x: number');
    expect(src).toContain('return x + 1');
  });

  it('strips inline // comments', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function foo() {
  // this is a comment
  return 1;
}`);
    const fn = sf.getFunctionOrThrow('foo');
    const src = extractFunctionSource(fn);
    expect(src).not.toContain('this is a comment');
    expect(src).toContain('return 1');
  });

  it('strips block comments /* ... */', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function foo() {
  /* block comment */
  return 2;
}`);
    const fn = sf.getFunctionOrThrow('foo');
    const src = extractFunctionSource(fn);
    expect(src).not.toContain('block comment');
    expect(src).toContain('return 2');
  });

  it('preserves type annotations', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function compute(items: string[], limit: number): boolean {
  return items.length < limit;
}`);
    const fn = sf.getFunctionOrThrow('compute');
    const src = extractFunctionSource(fn);
    expect(src).toContain('items: string[]');
    expect(src).toContain('limit: number');
    expect(src).toContain('boolean');
  });

  it('collapses excessive blank lines', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function foo() {



  return 1;
}`);
    const fn = sf.getFunctionOrThrow('foo');
    const src = extractFunctionSource(fn);
    expect(src).not.toMatch(/\n{3,}/);
  });

  it('returns trimmed output (no leading/trailing whitespace)', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function foo() { return 1; }`);
    const fn = sf.getFunctionOrThrow('foo');
    const src = extractFunctionSource(fn);
    expect(src).toBe(src.trim());
  });

  it('works for ArrowFunction', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `const add = (a: number, b: number): number => a + b;`);
    const init = sf.getVariableDeclarationOrThrow('add').getInitializer()!;
    const src = extractFunctionSource(init as AnalyzableFunction);
    expect(src).toContain('a: number');
    expect(src).toContain('b: number');
    expect(src).toContain('number =>');
  });

  it('works for MethodDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
class Sorter {
  sort(arr: number[]): number[] {
    return arr.sort();
  }
}`);
    const method = sf.getClassOrThrow('Sorter').getMethodOrThrow('sort');
    const src = extractFunctionSource(method);
    expect(src).toContain('sort');
    expect(src).toContain('arr: number[]');
  });
});

describe('extractCallerContext', () => {
  it('returns name and params for FunctionDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function greet(name: string): void {}`);
    const fn = sf.getFunctionOrThrow('greet');
    const ctx = extractCallerContext(fn);
    expect(ctx).toContain('greet');
    expect(ctx).toContain('name: string');
  });

  it('includes return type when annotated', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function add(a: number, b: number): number { return a + b; }`);
    const fn = sf.getFunctionOrThrow('add');
    const ctx = extractCallerContext(fn);
    expect(ctx).toMatch(/:\s*number/);
  });

  it('does not include return type annotation when absent', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function foo() { return 1; }`);
    const fn = sf.getFunctionOrThrow('foo');
    const ctx = extractCallerContext(fn);
    expect(ctx).toBe('foo()');
  });

  it('handles multiple parameters', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function fn(a: string, b: number, c: boolean): void {}`);
    const fn = sf.getFunctionOrThrow('fn');
    const ctx = extractCallerContext(fn);
    expect(ctx).toContain('a: string');
    expect(ctx).toContain('b: number');
    expect(ctx).toContain('c: boolean');
  });

  it('returns variable name for arrow function', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `const multiply = (x: number, y: number): number => x * y;`);
    const init = sf.getVariableDeclarationOrThrow('multiply').getInitializer()!;
    const ctx = extractCallerContext(init as AnalyzableFunction);
    expect(ctx).toContain('multiply');
    expect(ctx).toContain('x: number');
  });

  it('returns method name for MethodDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `class A { run(input: string[]): boolean { return true; } }`);
    const method = sf.getClassOrThrow('A').getMethodOrThrow('run');
    const ctx = extractCallerContext(method);
    expect(ctx).toContain('run');
    expect(ctx).toContain('input: string[]');
    expect(ctx).toContain('boolean');
  });

  it('handles no-parameter function', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `function noop(): void {}`);
    const fn = sf.getFunctionOrThrow('noop');
    const ctx = extractCallerContext(fn);
    expect(ctx).toBe('noop(): void');
  });
});
