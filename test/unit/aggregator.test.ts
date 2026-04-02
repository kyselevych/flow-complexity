import { describe, it, expect } from 'vitest';
import type { Node } from 'ts-morph';
import { createAggregator } from '../../src/pipeline/aggregator.js';
import { bigOFromClass } from '../../src/complexity/complexity-math.js';
import { BigOClass } from '../../src/types/complexity.js';
import type {
  FlowNode,
  ControlFlowKind,
  FlowNodeMetadata,
} from '../../src/types/flow-graph.js';
import type { ComplexityResult } from '../../src/types/complexity.js';

let _idCounter = 0;

function nextId(): string {
  return `node_${++_idCounter}`;
}

function mockNode(
  kind: ControlFlowKind,
  children: FlowNode[],
  opts?: {
    result?: ComplexityResult;
    metadata?: Partial<FlowNodeMetadata>;
  },
): FlowNode {
  return {
    id: nextId(),
    kind,
    astNode: {} as Node,
    location: { filePath: 'test.ts', startLine: 1, endLine: 10 },
    children,
    metadata: opts?.metadata ?? {},
    result: opts?.result,
  };
}

function mockLeaf(cls: BigOClass, confidence: number): FlowNode {
  const complexity = bigOFromClass(cls);
  return mockNode('leaf', [], {
    result: {
      complexity,
      confidence,
      source: 'deterministic',
      reasoning: `Mock leaf: ${complexity.notation}`,
    },
  });
}

const aggregator = createAggregator();

describe('Aggregator — leaf', () => {
  it('returns the leaf result unchanged', () => {
    const leaf = mockLeaf(BigOClass.ON, 0.9);
    const result = aggregator.aggregate(leaf);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBe(0.9);
    expect(result.source).toBe('deterministic');
  });

  it('returns O(1) with confidence 1.0 for a leaf with no result set', () => {
    const leaf = mockNode('leaf', []);
    const result = aggregator.aggregate(leaf);
    expect(result.complexity.class).toBe(BigOClass.O1);
    expect(result.confidence).toBe(1.0);
  });
});

describe('Aggregator — sequential', () => {
  it('sequential [O(1), O(n)] → O(n), confidence = min(1.0, 0.8) = 0.8', () => {
    const node = mockNode('sequential', [
      mockLeaf(BigOClass.O1, 1.0),
      mockLeaf(BigOClass.ON, 0.8),
    ]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(0.8);
    expect(result.source).toBe('aggregated');
  });

  it('sequential [O(n), O(n^2)] → O(n^2), confidence = min of children', () => {
    const node = mockNode('sequential', [
      mockLeaf(BigOClass.ON, 0.9),
      mockLeaf(BigOClass.ON2, 0.7),
    ]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.7);
    expect(result.source).toBe('aggregated');
  });

  it('empty sequential → O(1), confidence 1.0', () => {
    const node = mockNode('sequential', []);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.O1);
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBe('aggregated');
  });
});

describe('Aggregator — branch', () => {
  it('branch [O(n), O(n^2)] → O(n^2), confidence of the O(n^2) child', () => {
    const node = mockNode('branch', [
      mockLeaf(BigOClass.ON, 0.9),
      mockLeaf(BigOClass.ON2, 0.6),
    ]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.6);
    expect(result.source).toBe('aggregated');
  });

  it('branch [O(1), O(n)] → O(n), confidence of the O(n) child', () => {
    const node = mockNode('branch', [
      mockLeaf(BigOClass.O1, 1.0),
      mockLeaf(BigOClass.ON, 0.75),
    ]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(0.75);
    expect(result.source).toBe('aggregated');
  });
});

describe('Aggregator — loop', () => {
  it('loop with O(1) body → O(n), confidence = body confidence', () => {
    const node = mockNode('loop', [mockLeaf(BigOClass.O1, 1.0)]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(1.0);
    expect(result.source).toBe('aggregated');
  });

  it('loop with O(n) body → O(n^2), confidence = product of children', () => {
    const node = mockNode('loop', [mockLeaf(BigOClass.ON, 0.8)]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.8);
    expect(result.source).toBe('aggregated');
  });
});

describe('Aggregator — nested loop', () => {
  it('loop(loop(O(1))) → O(n^2)', () => {
    const inner = mockNode('loop', [mockLeaf(BigOClass.O1, 1.0)]);
    const outer = mockNode('loop', [inner]);
    const result = aggregator.aggregate(outer);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.source).toBe('aggregated');
  });
});

describe('Aggregator — async-parallel', () => {
  it('async-parallel [O(n), O(n^2)] → O(n^2), confidence = min', () => {
    const node = mockNode('async-parallel', [
      mockLeaf(BigOClass.ON, 0.9),
      mockLeaf(BigOClass.ON2, 0.6),
    ]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.6);
    expect(result.source).toBe('aggregated');
  });
});

describe('Aggregator — for-await', () => {
  it('for-await with O(1) body → O(n), same as loop', () => {
    const node = mockNode('for-await', [mockLeaf(BigOClass.O1, 1.0)]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(1.0);
    expect(result.source).toBe('aggregated');
  });

  it('for-await with O(n) body → O(n^2)', () => {
    const node = mockNode('for-await', [mockLeaf(BigOClass.ON, 0.9)]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.source).toBe('aggregated');
  });
});

describe('Aggregator — recursion', () => {
  it('recursion linear with O(1) body → O(n), confidence × 0.8', () => {
    const node = mockNode('recursion', [], {
      metadata: { recursionShrink: 'linear' },
    });
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(0.8);
    expect(result.source).toBe('aggregated');
  });

  it('recursion halving with O(1) body → O(log n), confidence × 0.8', () => {
    const node = mockNode('recursion', [], {
      metadata: { recursionShrink: 'halving' },
    });
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.OLogN);
    expect(result.confidence).toBeCloseTo(0.8);
    expect(result.source).toBe('aggregated');
  });

  it('recursion unknown → Unknown, confidence 0.0', () => {
    const node = mockNode('recursion', [], {
      metadata: { recursionShrink: 'unknown' },
    });
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.Unknown);
    expect(result.confidence).toBe(0.0);
    expect(result.source).toBe('aggregated');
  });

  it('recursion with no shrink metadata → Unknown, confidence 0.0', () => {
    const node = mockNode('recursion', []);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.Unknown);
    expect(result.confidence).toBe(0.0);
  });
});

describe('Aggregator — complex tree', () => {
  it('sequential [O(1), loop(branch [O(n), O(1)])] → O(n^2)', () => {
    const branch = mockNode('branch', [
      mockLeaf(BigOClass.ON, 0.9),
      mockLeaf(BigOClass.O1, 1.0),
    ]);
    const loop = mockNode('loop', [branch]);
    const root = mockNode('sequential', [
      mockLeaf(BigOClass.O1, 1.0),
      loop,
    ]);
    const result = aggregator.aggregate(root);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.source).toBe('aggregated');
  });

  it('deeply nested: sequential [loop(sequential [O(n), O(1)]), O(1)] → O(n^2)', () => {
    const innerSeq = mockNode('sequential', [
      mockLeaf(BigOClass.ON, 0.85),
      mockLeaf(BigOClass.O1, 1.0),
    ]);
    const loop = mockNode('loop', [innerSeq]);
    const root = mockNode('sequential', [loop, mockLeaf(BigOClass.O1, 1.0)]);
    const result = aggregator.aggregate(root);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.source).toBe('aggregated');
  });
});

describe('Aggregator — source field', () => {
  it('source is always "aggregated" for sequential node', () => {
    const node = mockNode('sequential', [mockLeaf(BigOClass.ON, 1.0)]);
    expect(aggregator.aggregate(node).source).toBe('aggregated');
  });

  it('source is always "aggregated" for branch node', () => {
    const node = mockNode('branch', [mockLeaf(BigOClass.ON, 1.0)]);
    expect(aggregator.aggregate(node).source).toBe('aggregated');
  });

  it('source is always "aggregated" for loop node', () => {
    const node = mockNode('loop', [mockLeaf(BigOClass.O1, 1.0)]);
    expect(aggregator.aggregate(node).source).toBe('aggregated');
  });

  it('source is always "aggregated" for recursion node', () => {
    const node = mockNode('recursion', [], {
      metadata: { recursionShrink: 'linear' },
    });
    expect(aggregator.aggregate(node).source).toBe('aggregated');
  });

  it('source is always "aggregated" for async-parallel node', () => {
    const node = mockNode('async-parallel', [mockLeaf(BigOClass.ON, 1.0)]);
    expect(aggregator.aggregate(node).source).toBe('aggregated');
  });

  it('source is always "aggregated" for for-await node', () => {
    const node = mockNode('for-await', [mockLeaf(BigOClass.O1, 1.0)]);
    expect(aggregator.aggregate(node).source).toBe('aggregated');
  });
});

describe('Aggregator — edge cases', () => {
  it('recursion linear with existing body child uses body complexity', () => {
    const bodyLeaf = mockLeaf(BigOClass.ON, 0.7);
    const node = mockNode('recursion', [bodyLeaf], {
      metadata: { recursionShrink: 'linear' },
    });
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.56);
  });

  it('recursion halving with O(n) body → O(n log n), confidence × 0.8', () => {
    const bodyLeaf = mockLeaf(BigOClass.ON, 0.9);
    const node = mockNode('recursion', [bodyLeaf], {
      metadata: { recursionShrink: 'halving' },
    });
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ONLogN);
    expect(result.confidence).toBeCloseTo(0.72);
  });

  it('branch with single child returns that child\'s complexity and confidence', () => {
    const node = mockNode('branch', [mockLeaf(BigOClass.ON2, 0.65)]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.65);
  });

  it('sequential with three children picks the maximum', () => {
    const node = mockNode('sequential', [
      mockLeaf(BigOClass.O1, 1.0),
      mockLeaf(BigOClass.OLogN, 0.95),
      mockLeaf(BigOClass.ON, 0.85),
    ]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(0.85);
  });

  it('loop with multiple children aggregates body as sequential', () => {
    const node = mockNode('loop', [
      mockLeaf(BigOClass.O1, 1.0),
      mockLeaf(BigOClass.ON, 0.8),
    ]);
    const result = aggregator.aggregate(node);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(0.8);
  });
});
