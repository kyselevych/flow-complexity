import { describe, it, expect } from 'vitest';
import type { Node } from 'ts-morph';
import {
  createComplexityEvaluator,
  ComplexityEvaluator,
} from '../../src/pipeline/complexity-evaluator.js';
import { createMemoCache, MemoCache } from '../../src/cache/memo-cache.js';
import { BigOClass } from '../../src/types/complexity.js';
import { bigOFromClass } from '../../src/complexity/complexity-math.js';
import type { FlowNode, ControlFlowKind, FlowNodeMetadata } from '../../src/types/flow-graph.js';
import type { ComplexityResult } from '../../src/types/complexity.js';
import type { ClassifiedLeaf, ClassificationResult } from '../../src/types/classification.js';
import type { LLMClient, LLMClientOptions, LLMResponse } from '../../src/evaluators/llm/llm-client.js';
import type { LLMConfig } from '../../src/types/config.js';

let _idCounter = 0;

function nextId(): string {
  return `ce_node_${++_idCounter}`;
}

function mockNode(
  kind: ControlFlowKind,
  children: FlowNode[],
  opts?: {
    result?: ComplexityResult;
    metadata?: Partial<FlowNodeMetadata>;
    sourceText?: string;
  },
): FlowNode {
  const sourceText = opts?.sourceText ?? 'function stub() {}';
  const astStub = {
    getText: () => sourceText,
    getKind: () => 0,
    getChildren: () => [],
    forEachDescendant: () => {},
    getStartLineNumber: () => 1,
    getEndLineNumber: () => 5,
    getSourceFile: () => ({ getFilePath: () => 'test.ts' }),
  };

  return {
    id: nextId(),
    kind,
    astNode: astStub as unknown as Node,
    location: { filePath: 'test.ts', startLine: 1, endLine: 10 },
    children,
    metadata: opts?.metadata ?? {},
    result: opts?.result,
  };
}

function mockLeafNode(metadata?: Partial<FlowNodeMetadata>, sourceText?: string): FlowNode {
  return mockNode('leaf', [], { metadata, sourceText });
}

function makeClassification(leaves: ClassifiedLeaf[]): ClassificationResult {
  const deterministicCount = leaves.filter(l => l.classification === 'deterministic').length;
  const semanticCount = leaves.filter(l => l.classification === 'semantic').length;
  return { leaves, deterministicCount, semanticCount };
}

function makeResponse(complexity: string, variable: string, reasoning: string): string {
  return JSON.stringify({ complexity, variable, reasoning });
}

function createMockLLMClient(
  responses: string[],
): LLMClient & { callCount: number } {
  let callIndex = 0;
  const client = {
    callCount: 0,
    async complete(_prompt: string, _options: LLMClientOptions): Promise<LLMResponse> {
      const response = responses[callIndex++ % responses.length];
      client.callCount = callIndex;
      return { content: response, tokensUsed: { input: 100, output: 50 } };
    },
  };
  return client;
}

const defaultLLMConfig: LLMConfig = {
  provider: 'anthropic',
  model: 'test-model',
  runs: 1,
  temperatures: [0],
  maxTokens: 512,
};

describe('ComplexityEvaluator — deterministic leaf', () => {
  it('evaluates a deterministic leaf via the pattern matcher (O(1) constant)', async () => {
    const cache = createMemoCache();
    const evaluator = createComplexityEvaluator({
      llmConfig: defaultLLMConfig,
      cache,
      noLlm: true,
    });

    const leaf: ClassifiedLeaf = {
      node: mockLeafNode({ isExternal: false }),
      classification: 'deterministic',
      reason: 'Simple expression — O(1)',
    };

    const classification = makeClassification([leaf]);
    await evaluator.evaluateLeaves(classification);

    expect(leaf.node.result).toBeDefined();
    expect(leaf.node.result!.source).toBe('deterministic');
    expect(leaf.node.result!.confidence).toBe(1.0);
    expect(leaf.node.result!.complexity.class).toBe(BigOClass.O1);
  });

  it('evaluates a deterministic leaf with a known builtin callee (sort)', async () => {
    const cache = createMemoCache();
    const evaluator = createComplexityEvaluator({
      llmConfig: defaultLLMConfig,
      cache,
      noLlm: true,
    });

    const sortSource = 'arr.sort()';
    const astStub = {
      getText: () => sortSource,
      getKind: () => 0,
      getChildren: () => [],
      forEachDescendant: (_cb: (child: unknown) => void) => {},
      getStartLineNumber: () => 1,
      getEndLineNumber: () => 2,
      getSourceFile: () => ({ getFilePath: () => 'test.ts' }),
    };
    const sortNode: FlowNode = {
      id: nextId(),
      kind: 'leaf',
      astNode: astStub as unknown as Node,
      location: { filePath: 'test.ts', startLine: 1, endLine: 2 },
      children: [],
      metadata: { calleeName: 'arr.sort', isExternal: true },
    };

    const leaf: ClassifiedLeaf = {
      node: sortNode,
      classification: 'deterministic',
      reason: 'Known builtin: sort',
      builtinComplexity: 'O(n log n)',
    };

    const classification = makeClassification([leaf]);
    await evaluator.evaluateLeaves(classification);

    expect(leaf.node.result).toBeDefined();
    expect(leaf.node.result!.source).toBe('deterministic');
  });
});

describe('ComplexityEvaluator — semantic leaf with LLM', () => {
  it('evaluates a semantic leaf using the mock LLM client', async () => {
    const cache = createMemoCache();
    const mockClient = createMockLLMClient([
      makeResponse('O(n)', 'n', 'Linear iteration.'),
    ]);

    const evaluator = createComplexityEvaluator({
      llmClient: mockClient,
      llmConfig: { ...defaultLLMConfig, runs: 1, temperatures: [0] },
      cache,
      noLlm: false,
    });

    const leaf: ClassifiedLeaf = {
      node: mockLeafNode({ calleeName: 'db.query', isExternal: true }, 'db.query(sql)'),
      classification: 'semantic',
      reason: 'External call to db.query — requires LLM evaluation',
    };

    const classification = makeClassification([leaf]);
    await evaluator.evaluateLeaves(classification);

    expect(leaf.node.result).toBeDefined();
    expect(leaf.node.result!.source).toBe('llm');
    expect(leaf.node.result!.complexity.class).toBe(BigOClass.ON);
    expect(mockClient.callCount).toBe(1);
  });
});

describe('ComplexityEvaluator — no-LLM mode', () => {
  it('assigns Unknown with confidence 0.0 for semantic leaf when --no-llm', async () => {
    const cache = createMemoCache();
    const evaluator = createComplexityEvaluator({
      llmConfig: defaultLLMConfig,
      cache,
      noLlm: true,
    });

    const leaf: ClassifiedLeaf = {
      node: mockLeafNode({ calleeName: 'db.query', isExternal: true }),
      classification: 'semantic',
      reason: 'External call — requires LLM evaluation',
    };

    const classification = makeClassification([leaf]);
    await evaluator.evaluateLeaves(classification);

    expect(leaf.node.result).toBeDefined();
    expect(leaf.node.result!.complexity.class).toBe(BigOClass.Unknown);
    expect(leaf.node.result!.confidence).toBe(0.0);
  });
});

describe('ComplexityEvaluator — cache', () => {
  it('uses cached result on second evaluation of same callee name', async () => {
    const cache = createMemoCache();
    const mockClient = createMockLLMClient([
      makeResponse('O(n)', 'n', 'Linear.'),
    ]);

    const evaluator = createComplexityEvaluator({
      llmClient: mockClient,
      llmConfig: { ...defaultLLMConfig, runs: 1, temperatures: [0] },
      cache,
      noLlm: false,
    });

    const leaf1: ClassifiedLeaf = {
      node: mockLeafNode({ calleeName: 'fetchData', isExternal: true }, 'fetchData()'),
      classification: 'semantic',
      reason: 'External call',
    };
    await evaluator.evaluateLeaves(makeClassification([leaf1]));
    expect(mockClient.callCount).toBe(1);

    const leaf2: ClassifiedLeaf = {
      node: mockLeafNode({ calleeName: 'fetchData', isExternal: true }, 'fetchData()'),
      classification: 'semantic',
      reason: 'External call',
    };
    await evaluator.evaluateLeaves(makeClassification([leaf2]));

    expect(mockClient.callCount).toBe(1);
    expect(leaf2.node.result).toBeDefined();
    expect(leaf2.node.result!.complexity.class).toBe(BigOClass.ON);
  });

  it('caches deterministic results too', async () => {
    const cache = createMemoCache();
    const evaluator = createComplexityEvaluator({
      llmConfig: defaultLLMConfig,
      cache,
      noLlm: true,
    });

    const sourceText = 'function trivial() { return 1; }';

    const leaf1: ClassifiedLeaf = {
      node: mockLeafNode({ isExternal: false }, sourceText),
      classification: 'deterministic',
      reason: 'O(1)',
    };
    await evaluator.evaluateLeaves(makeClassification([leaf1]));
    expect(cache.size).toBe(1);

    const leaf2: ClassifiedLeaf = {
      node: mockLeafNode({ isExternal: false }, sourceText),
      classification: 'deterministic',
      reason: 'O(1)',
    };
    await evaluator.evaluateLeaves(makeClassification([leaf2]));
    expect(cache.size).toBe(1);
    expect(leaf2.node.result).toBeDefined();
    expect(leaf2.node.result!.complexity.class).toBe(BigOClass.O1);
  });
});

describe('ComplexityEvaluator — mixed leaves', () => {
  it('handles a mix of deterministic and semantic leaves', async () => {
    const cache = createMemoCache();
    const mockClient = createMockLLMClient([
      makeResponse('O(n^2)', 'records', 'Quadratic query result.'),
    ]);

    const evaluator = createComplexityEvaluator({
      llmClient: mockClient,
      llmConfig: { ...defaultLLMConfig, runs: 1, temperatures: [0] },
      cache,
      noLlm: false,
    });

    const deterministicLeaf: ClassifiedLeaf = {
      node: mockLeafNode({ isExternal: false }),
      classification: 'deterministic',
      reason: 'Simple expression — O(1)',
    };

    const semanticLeaf: ClassifiedLeaf = {
      node: mockLeafNode({ calleeName: 'db.query', isExternal: true }, 'db.query(sql)'),
      classification: 'semantic',
      reason: 'External call to db.query',
    };

    const classification = makeClassification([deterministicLeaf, semanticLeaf]);
    await evaluator.evaluateLeaves(classification);

    expect(deterministicLeaf.node.result).toBeDefined();
    expect(deterministicLeaf.node.result!.source).toBe('deterministic');
    expect(deterministicLeaf.node.result!.complexity.class).toBe(BigOClass.O1);

    expect(semanticLeaf.node.result).toBeDefined();
    expect(semanticLeaf.node.result!.source).toBe('llm');
    expect(semanticLeaf.node.result!.complexity.class).toBe(BigOClass.ON2);

    expect(mockClient.callCount).toBe(1);
  });

  it('handles multiple deterministic leaves without LLM calls', async () => {
    const cache = createMemoCache();
    const mockClient = createMockLLMClient([]);

    const evaluator = createComplexityEvaluator({
      llmClient: mockClient,
      llmConfig: defaultLLMConfig,
      cache,
      noLlm: false,
    });

    const leaf1: ClassifiedLeaf = {
      node: mockLeafNode({ isExternal: false }, 'x + 1'),
      classification: 'deterministic',
      reason: 'O(1)',
    };
    const leaf2: ClassifiedLeaf = {
      node: mockLeafNode({ isExternal: false }, 'y * 2'),
      classification: 'deterministic',
      reason: 'O(1)',
    };

    const classification = makeClassification([leaf1, leaf2]);
    await evaluator.evaluateLeaves(classification);

    expect(leaf1.node.result).toBeDefined();
    expect(leaf2.node.result).toBeDefined();
    expect(mockClient.callCount).toBe(0);
  });
});
