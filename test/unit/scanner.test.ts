import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createScanner, ScanResult } from '../../src/pipeline/scanner.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures');

describe('createScanner / scan()', () => {
  describe('scanner-basic.ts fixture', () => {
    let results: ScanResult[];

    const getResults = () => {
      if (!results) {
        const scanner = createScanner({ projectPath: FIXTURES_DIR });
        results = scanner.scan();
      }
      return results;
    };

    it('finds the annotated function declaration (simpleLoop)', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'simpleLoop');
      expect(found).toBeDefined();
    });

    it('finds the annotated arrow function (arrowFunc)', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'arrowFunc');
      expect(found).toBeDefined();
    });

    it('ignores non-annotated function declarations (notAnnotated)', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'notAnnotated');
      expect(found).toBeUndefined();
    });

    it('extracts @complexity-input value for simpleLoop', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'simpleLoop');
      expect(found?.declaredInputVariable).toBe('items');
    });

    it('leaves declaredInputVariable undefined when tag is absent (arrowFunc)', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'arrowFunc');
      expect(found?.declaredInputVariable).toBeUndefined();
    });

    it('sets correct filePath for scanner-basic.ts results', () => {
      const r = getResults();
      const basicResults = r.filter((x) =>
        x.filePath.endsWith('scanner-basic.ts'),
      );
      expect(basicResults.length).toBeGreaterThan(0);
      for (const res of basicResults) {
        expect(res.filePath).toContain('scanner-basic.ts');
      }
    });

    it('records correct startLine / endLine for simpleLoop', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'simpleLoop');
      expect(found).toBeDefined();
      // simpleLoop body starts at line 5 in scanner-basic.ts
      expect(found!.location.startLine).toBe(5);
      expect(found!.location.endLine).toBeGreaterThan(found!.location.startLine);
    });

    it('location.filePath matches result.filePath', () => {
      const r = getResults();
      for (const res of r) {
        expect(res.location.filePath).toBe(res.filePath);
      }
    });

    it('astNode is set for every result', () => {
      const r = getResults();
      for (const res of r) {
        expect(res.astNode).toBeDefined();
      }
    });
  });

  describe('scanner-class.ts fixture', () => {
    let results: ScanResult[];

    const getResults = () => {
      if (!results) {
        const scanner = createScanner({ projectPath: FIXTURES_DIR });
        results = scanner.scan();
      }
      return results;
    };

    it('finds annotated class method (process)', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'process');
      expect(found).toBeDefined();
    });

    it('ignores non-annotated class method (helper)', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'helper');
      expect(found).toBeUndefined();
    });

    it('extracts @complexity-input for process method', () => {
      const r = getResults();
      const found = r.find((x) => x.functionName === 'process');
      expect(found?.declaredInputVariable).toBe('records');
    });

    it('sets correct filePath for scanner-class.ts results', () => {
      const r = getResults();
      const classResults = r.filter((x) => x.filePath.endsWith('scanner-class.ts'));
      expect(classResults.length).toBe(1);
    });
  });

  describe('project path variants', () => {
    it('accepts a directory path and finds tsconfig.json automatically', () => {
      const scanner = createScanner({ projectPath: FIXTURES_DIR });
      const r = scanner.scan();
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBeGreaterThan(0);
    });

    it('accepts an explicit tsconfig.json path', () => {
      const tsconfigPath = path.join(FIXTURES_DIR, 'tsconfig.json');
      const scanner = createScanner({ projectPath: tsconfigPath });
      const r = scanner.scan();
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBeGreaterThan(0);
    });
  });

  describe('total result count', () => {
    it('returns exactly 4 annotated functions from the fixture files', () => {
      const scanner = createScanner({ projectPath: FIXTURES_DIR });
      const r = scanner.scan();
      expect(r).toHaveLength(4);
    });
  });
});
