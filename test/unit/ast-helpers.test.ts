import { describe, it, expect } from 'vitest';
import { Project, Node } from 'ts-morph';
import {
  isAnalyzableFunction,
  getFunctionName,
  getJSDocTags,
  hasJSDocTag,
  getCallExpressions,
  resolveCallTarget,
  AnalyzableFunction,
} from '../../src/util/ast-helpers.js';

function createProject() {
  return new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
}

describe('isAnalyzableFunction', () => {
  it('returns true for FunctionDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'function foo() {}');
    const fn = sf.getFunctionOrThrow('foo');
    expect(isAnalyzableFunction(fn)).toBe(true);
  });

  it('returns true for MethodDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'class A { method() {} }');
    const cls = sf.getClassOrThrow('A');
    const method = cls.getMethodOrThrow('method');
    expect(isAnalyzableFunction(method)).toBe(true);
  });

  it('returns true for ArrowFunction', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'const foo = () => {};');
    const varDecl = sf.getVariableDeclarationOrThrow('foo');
    const init = varDecl.getInitializer()!;
    expect(Node.isArrowFunction(init)).toBe(true);
    expect(isAnalyzableFunction(init as AnalyzableFunction)).toBe(true);
  });

  it('returns false for Identifier', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'const x = 1;');
    const decl = sf.getVariableDeclarationOrThrow('x');
    expect(isAnalyzableFunction(decl.getNameNode())).toBe(false);
  });

  it('returns false for ClassDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'class A {}');
    const cls = sf.getClassOrThrow('A');
    expect(isAnalyzableFunction(cls)).toBe(false);
  });
});

describe('getFunctionName', () => {
  it('returns name of FunctionDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'function myFunc() {}');
    const fn = sf.getFunctionOrThrow('myFunc');
    expect(getFunctionName(fn)).toBe('myFunc');
  });

  it('returns <anonymous> for anonymous FunctionDeclaration', () => {
    const project = createProject();
    // export default function() {} is anonymous
    const sf = project.createSourceFile('a.ts', 'export default function() {}');
    const fns = sf.getFunctions();
    expect(getFunctionName(fns[0])).toBe('<anonymous>');
  });

  it('returns name of MethodDeclaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'class A { compute() {} }');
    const method = sf.getClassOrThrow('A').getMethodOrThrow('compute');
    expect(getFunctionName(method)).toBe('compute');
  });

  it('returns variable name for arrow function assigned to const', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'const myArrow = () => {};');
    const init = sf.getVariableDeclarationOrThrow('myArrow').getInitializer()!;
    expect(getFunctionName(init as AnalyzableFunction)).toBe('myArrow');
  });

  it('returns <anonymous> for arrow function not in variable declaration', () => {
    const project = createProject();
    // Arrow function passed as argument
    const sf = project.createSourceFile('a.ts', 'arr.map(() => 1);');
    let arrowFn: AnalyzableFunction | undefined;
    sf.forEachDescendant((node) => {
      if (Node.isArrowFunction(node)) arrowFn = node;
    });
    expect(arrowFn).toBeDefined();
    expect(getFunctionName(arrowFn!)).toBe('<anonymous>');
  });
});

describe('getJSDocTags', () => {
  it('returns empty map when no JSDoc', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'function foo() {}');
    const fn = sf.getFunctionOrThrow('foo');
    expect(getJSDocTags(fn).size).toBe(0);
  });

  it('returns tags from JSDoc', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
/** @complexity O(n) */
function foo() {}`);
    const fn = sf.getFunctionOrThrow('foo');
    const tags = getJSDocTags(fn);
    expect(tags.has('complexity')).toBe(true);
    expect(tags.get('complexity')).toContain('O(n)');
  });

  it('handles multiple JSDoc tags', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
/**
 * @param items the list
 * @returns number
 */
function foo(items: string[]): number { return 0; }`);
    const fn = sf.getFunctionOrThrow('foo');
    const tags = getJSDocTags(fn);
    expect(tags.has('param')).toBe(true);
    expect(tags.has('returns')).toBe(true);
  });
});

describe('hasJSDocTag', () => {
  it('returns true when tag exists', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
/** @complexity O(n) */
function foo() {}`);
    const fn = sf.getFunctionOrThrow('foo');
    expect(hasJSDocTag(fn, 'complexity')).toBe(true);
  });

  it('returns false when tag does not exist', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'function foo() {}');
    const fn = sf.getFunctionOrThrow('foo');
    expect(hasJSDocTag(fn, 'complexity')).toBe(false);
  });
});

describe('getCallExpressions', () => {
  it('returns empty array for empty function body', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'function foo() {}');
    const fn = sf.getFunctionOrThrow('foo');
    expect(getCallExpressions(fn)).toHaveLength(0);
  });

  it('returns call expressions in function body', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function foo() {
  bar();
  baz(1, 2);
}
function bar() {}
function baz(a: number, b: number) {}`);
    const fn = sf.getFunctionOrThrow('foo');
    const calls = getCallExpressions(fn);
    expect(calls.length).toBe(2);
  });

  it('returns nested call expressions', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function foo() {
  const x = outer(inner());
}
declare function outer(x: number): number;
declare function inner(): number;`);
    const fn = sf.getFunctionOrThrow('foo');
    const calls = getCallExpressions(fn);
    expect(calls.length).toBe(2);
  });

  it('works for method declaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
class A {
  run() {
    helper();
  }
}
function helper() {}`);
    const method = sf.getClassOrThrow('A').getMethodOrThrow('run');
    const calls = getCallExpressions(method);
    expect(calls.length).toBe(1);
  });

  it('works for arrow function', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
const fn = () => {
  doSomething();
};
function doSomething() {}`);
    const init = sf.getVariableDeclarationOrThrow('fn').getInitializer()!;
    const calls = getCallExpressions(init as AnalyzableFunction);
    expect(calls.length).toBe(1);
  });
});

describe('resolveCallTarget', () => {
  it('returns undefined for non-call node', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', 'const x = 1;');
    const decl = sf.getVariableDeclarationOrThrow('x');
    expect(resolveCallTarget(decl)).toBeUndefined();
  });

  it('resolves call to function declaration in same file', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function foo() {
  bar();
}
function bar() {}`);
    const fooFn = sf.getFunctionOrThrow('foo');
    const calls = getCallExpressions(fooFn);
    expect(calls.length).toBe(1);
    const resolved = resolveCallTarget(calls[0]);
    expect(resolved).toBeDefined();
    expect(getFunctionName(resolved!)).toBe('bar');
  });

  it('resolves call to arrow function in variable declaration', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function main() {
  helper();
}
const helper = () => 42;`);
    const mainFn = sf.getFunctionOrThrow('main');
    const calls = getCallExpressions(mainFn);
    const resolved = resolveCallTarget(calls[0]);
    expect(resolved).toBeDefined();
    expect(getFunctionName(resolved!)).toBe('helper');
  });

  it('returns undefined for calls to external/unresolvable functions', () => {
    const project = createProject();
    const sf = project.createSourceFile('a.ts', `
function main() {
  console.log('hello');
}`);
    const mainFn = sf.getFunctionOrThrow('main');
    const calls = getCallExpressions(mainFn);
    expect(() => resolveCallTarget(calls[0])).not.toThrow();
  });
});
