import { ComplexityResult } from '../types/complexity.js';

export interface MemoCache {
  get(key: string): ComplexityResult | undefined;
  set(key: string, result: ComplexityResult): void;
  has(key: string): boolean;
  readonly size: number;
  clear(): void;
}

export function createMemoCache(): MemoCache {
  const store = new Map<string, ComplexityResult>();

  return {
    get(key: string): ComplexityResult | undefined {
      return store.get(key);
    },
    set(key: string, result: ComplexityResult): void {
      store.set(key, result);
    },
    has(key: string): boolean {
      return store.has(key);
    },
    get size(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
  };
}
