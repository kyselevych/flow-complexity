import { describe, it, expect } from 'vitest';
import type { Node } from 'ts-morph';
import { createLeafClassifier } from '../../src/pipeline/leaf-classifier.js';
import type { FlowNode, FlowNodeMetadata } from '../../src/types/flow-graph.js';

let _idCounter = 0;

function makeLeafNode(
  overrides: Partial<FlowNode> & { metadata: FlowNodeMetadata },
): FlowNode {
  return {
    id: `node_${++_idCounter}`,
    kind: 'leaf',
    astNode: {} as Node,
    location: { filePath: 'test.ts', startLine: 1, endLine: 1 },
    children: [],
    ...overrides,
  };
}

function makeTreeWithLeaves(leaves: FlowNode[]): FlowNode {
  return {
    id: `node_${++_idCounter}`,
    kind: 'sequential',
    astNode: {} as Node,
    location: { filePath: 'test.ts', startLine: 1, endLine: 99 },
    children: leaves,
    metadata: {},
  };
}

function makeNestedTree(leaves: FlowNode[]): FlowNode {
  const mid: FlowNode = {
    id: `node_${++_idCounter}`,
    kind: 'loop',
    astNode: {} as Node,
    location: { filePath: 'test.ts', startLine: 2, endLine: 10 },
    children: leaves,
    metadata: { loopVariable: 'i', loopBound: 'n' },
  };
  return {
    id: `node_${++_idCounter}`,
    kind: 'sequential',
    astNode: {} as Node,
    location: { filePath: 'test.ts', startLine: 1, endLine: 99 },
    children: [mid],
    metadata: {},
  };
}

describe('LeafClassifier', () => {
  const classifier = createLeafClassifier();

  describe('simple expression leaf', () => {
    it('classifies a leaf with no callee and not external as deterministic', () => {
      const leaf = makeLeafNode({ metadata: {} });
      const result = classifier.classify(leaf);

      expect(result.leaves).toHaveLength(1);
      expect(result.deterministicCount).toBe(1);
      expect(result.semanticCount).toBe(0);

      const classified = result.leaves[0];
      expect(classified.classification).toBe('deterministic');
      expect(classified.reason).toMatch(/simple expression/i);
    });

    it('does not set builtinComplexity for simple expression', () => {
      const leaf = makeLeafNode({ metadata: {} });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].builtinComplexity).toBeUndefined();
    });
  });

  describe('Array.sort call leaf', () => {
    it('classifies as deterministic with O(n log n) builtinComplexity', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'arr.sort', isExternal: true },
      });
      const result = classifier.classify(leaf);

      expect(result.deterministicCount).toBe(1);
      expect(result.semanticCount).toBe(0);

      const classified = result.leaves[0];
      expect(classified.classification).toBe('deterministic');
      expect(classified.builtinComplexity).toBe('O(n log n)');
    });

    it('also matches bare "sort" callee name', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'sort', isExternal: false },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('deterministic');
      expect(result.leaves[0].builtinComplexity).toBe('O(n log n)');
    });
  });

  describe('Map.get call leaf', () => {
    it('classifies as deterministic with O(1) builtinComplexity', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'map.get', isExternal: true },
      });
      const result = classifier.classify(leaf);

      const classified = result.leaves[0];
      expect(classified.classification).toBe('deterministic');
      expect(classified.builtinComplexity).toBe('O(1)');
    });

    it('treats Set.has the same way — O(1)', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'set.has', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].builtinComplexity).toBe('O(1)');
    });
  });

  describe('external library call', () => {
    it('classifies unknown external call as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'lodash.cloneDeep', isExternal: true },
      });
      const result = classifier.classify(leaf);

      expect(result.semanticCount).toBe(1);
      expect(result.deterministicCount).toBe(0);

      const classified = result.leaves[0];
      expect(classified.classification).toBe('semantic');
    });

    it('classifies external call with no callee name as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });
  });

  describe('database call', () => {
    it('classifies db.query as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'db.query', isExternal: true },
      });
      const result = classifier.classify(leaf);

      expect(result.leaves[0].classification).toBe('semantic');
      expect(result.leaves[0].reason).toMatch(/database|API|network/i);
    });

    it('classifies db.find as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'db.find', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });

    it('classifies postgres call as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'postgres.execute', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });
  });

  describe('fetch / HTTP call', () => {
    it('classifies fetch as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'fetch', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });

    it('classifies http.get as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'http.get', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });

    it('classifies axios.request as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'axios.request', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });

    it('classifies graphql call as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'client.graphql', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });
  });

  describe('mixed tree', () => {
    it('counts deterministic and semantic leaves correctly', () => {
      const leaves = [
        makeLeafNode({ metadata: {} }),                                       // deterministic
        makeLeafNode({ metadata: { calleeName: 'arr.sort', isExternal: true } }), // deterministic builtin
        makeLeafNode({ metadata: { calleeName: 'db.query', isExternal: true } }), // semantic
        makeLeafNode({ metadata: { calleeName: 'lodash.cloneDeep', isExternal: true } }), // semantic
      ];
      const tree = makeTreeWithLeaves(leaves);
      const result = classifier.classify(tree);

      expect(result.leaves).toHaveLength(4);
      expect(result.deterministicCount).toBe(2);
      expect(result.semanticCount).toBe(2);
    });
  });

  describe('tree with no leaf nodes', () => {
    it('returns empty leaves and zero counts', () => {
      const loop: FlowNode = {
        id: `node_${++_idCounter}`,
        kind: 'loop',
        astNode: {} as Node,
        location: { filePath: 'test.ts', startLine: 1, endLine: 5 },
        children: [],
        metadata: { loopVariable: 'i', loopBound: 'n' },
      };
      const root = makeTreeWithLeaves([]);
      (root as any).children = [loop];

      const result = classifier.classify(root);
      expect(result.leaves).toHaveLength(0);
      expect(result.deterministicCount).toBe(0);
      expect(result.semanticCount).toBe(0);
    });
  });

  describe('nested tree', () => {
    it('collects leaves nested inside loop nodes', () => {
      const deepLeaf1 = makeLeafNode({ metadata: {} });
      const deepLeaf2 = makeLeafNode({
        metadata: { calleeName: 'db.query', isExternal: true },
      });
      const tree = makeNestedTree([deepLeaf1, deepLeaf2]);
      const result = classifier.classify(tree);

      expect(result.leaves).toHaveLength(2);
      expect(result.deterministicCount).toBe(1);
      expect(result.semanticCount).toBe(1);
    });

    it('handles three levels of nesting', () => {
      const innerLeaf = makeLeafNode({ metadata: { calleeName: 'arr.map', isExternal: true } });
      const mid: FlowNode = {
        id: `node_${++_idCounter}`,
        kind: 'branch',
        astNode: {} as Node,
        location: { filePath: 'test.ts', startLine: 3, endLine: 8 },
        children: [innerLeaf],
        metadata: {},
      };
      const outer: FlowNode = {
        id: `node_${++_idCounter}`,
        kind: 'loop',
        astNode: {} as Node,
        location: { filePath: 'test.ts', startLine: 2, endLine: 10 },
        children: [mid],
        metadata: {},
      };
      const root = makeTreeWithLeaves([outer]);

      const result = classifier.classify(root);
      expect(result.leaves).toHaveLength(1);
      expect(result.leaves[0].classification).toBe('deterministic');
      expect(result.leaves[0].builtinComplexity).toBe('O(n)');
    });
  });

  describe('edge cases', () => {
    it('classifies a root leaf node directly (no children wrapper)', () => {
      const leaf = makeLeafNode({ metadata: { calleeName: 'arr.push', isExternal: true } });
      const result = classifier.classify(leaf);
      expect(result.leaves).toHaveLength(1);
      expect(result.leaves[0].classification).toBe('deterministic');
      expect(result.leaves[0].builtinComplexity).toBe('O(1)');
    });

    it('classifies Object.keys as deterministic O(n)', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'Object.keys', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('deterministic');
      expect(result.leaves[0].builtinComplexity).toBe('O(n)');
    });

    it('classifies JSON.stringify as deterministic O(n)', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'JSON.stringify', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('deterministic');
      expect(result.leaves[0].builtinComplexity).toBe('O(n)');
    });

    it('preserves the original FlowNode reference on ClassifiedLeaf', () => {
      const leaf = makeLeafNode({ metadata: {} });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].node).toBe(leaf);
    });

    it('classifies redis call as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'redis.get', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });

    it('classifies mongo call as semantic', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'mongo.findOne', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('semantic');
    });

    it('treats forEach as O(n) builtin', () => {
      const leaf = makeLeafNode({
        metadata: { calleeName: 'arr.forEach', isExternal: true },
      });
      const result = classifier.classify(leaf);
      expect(result.leaves[0].classification).toBe('deterministic');
      expect(result.leaves[0].builtinComplexity).toBe('O(n)');
    });
  });
});
