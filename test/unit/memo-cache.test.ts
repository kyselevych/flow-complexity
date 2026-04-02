import { describe, it, expect } from 'vitest';
import { createMemoCache } from '../../src/cache/memo-cache.js';
import { BigOClass } from '../../src/types/complexity.js';
import { ComplexityResult } from '../../src/types/complexity.js';

function makeResult(notation: string): ComplexityResult {
  return {
    complexity: { class: BigOClass.ON, variable: 'n', notation },
    confidence: 0.9,
    source: 'deterministic',
    reasoning: 'test',
  };
}

describe('createMemoCache', () => {
  it('starts empty', () => {
    const cache = createMemoCache();
    expect(cache.size).toBe(0);
  });

  it('has() returns false for unknown key', () => {
    const cache = createMemoCache();
    expect(cache.has('missing')).toBe(false);
  });

  it('get() returns undefined for unknown key', () => {
    const cache = createMemoCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('set() stores a value retrievable by get()', () => {
    const cache = createMemoCache();
    const result = makeResult('O(n)');
    cache.set('fn:hash1', result);
    expect(cache.get('fn:hash1')).toBe(result);
  });

  it('has() returns true after set()', () => {
    const cache = createMemoCache();
    cache.set('key', makeResult('O(n)'));
    expect(cache.has('key')).toBe(true);
  });

  it('size increments on each unique set()', () => {
    const cache = createMemoCache();
    cache.set('a', makeResult('O(1)'));
    expect(cache.size).toBe(1);
    cache.set('b', makeResult('O(n)'));
    expect(cache.size).toBe(2);
  });

  it('set() overwrites existing key without incrementing size', () => {
    const cache = createMemoCache();
    const r1 = makeResult('O(n)');
    const r2 = makeResult('O(n^2)');
    cache.set('key', r1);
    cache.set('key', r2);
    expect(cache.size).toBe(1);
    expect(cache.get('key')).toBe(r2);
  });

  it('clear() removes all entries', () => {
    const cache = createMemoCache();
    cache.set('a', makeResult('O(1)'));
    cache.set('b', makeResult('O(n)'));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBeUndefined();
  });

  it('multiple independent caches do not share state', () => {
    const c1 = createMemoCache();
    const c2 = createMemoCache();
    c1.set('shared-key', makeResult('O(n)'));
    expect(c2.has('shared-key')).toBe(false);
  });

  it('preserves full ComplexityResult with llmRuns', () => {
    const cache = createMemoCache();
    const result: ComplexityResult = {
      complexity: { class: BigOClass.ON2, variable: 'n', notation: 'O(n^2)' },
      confidence: 0.85,
      source: 'llm',
      reasoning: 'nested loops',
      llmRuns: [
        {
          complexity: { class: BigOClass.ON2, variable: 'n', notation: 'O(n^2)' },
          reasoning: 'two loops',
          rawResponse: 'O(n^2)',
        },
      ],
    };
    cache.set('fn:abc123', result);
    const retrieved = cache.get('fn:abc123');
    expect(retrieved).toBe(result);
    expect(retrieved?.llmRuns?.length).toBe(1);
  });
});
