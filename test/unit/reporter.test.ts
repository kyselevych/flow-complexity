import { describe, it, expect } from 'vitest';
import type { Node } from 'ts-morph';
import { createReporter } from '../../src/pipeline/reporter.js';
import { bigOFromClass } from '../../src/complexity/complexity-math.js';
import { BigOClass } from '../../src/types/complexity.js';
import type {
  FlowNode,
  ControlFlowKind,
  FlowNodeMetadata,
  AnalysisTarget,
  SourceLocation,
} from '../../src/types/flow-graph.js';
import type { ComplexityResult } from '../../src/types/complexity.js';

let _idCounter = 0;

function nextId(): string {
  return `node_${++_idCounter}`;
}

const DEFAULT_LOCATION: SourceLocation = {
  filePath: 'test.ts',
  startLine: 1,
  endLine: 10,
};

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
    location: DEFAULT_LOCATION,
    children,
    metadata: opts?.metadata ?? {},
    result: opts?.result,
  };
}

function mockLeaf(
  cls: BigOClass,
  confidence: number,
  source: 'deterministic' | 'llm' | 'aggregated' = 'deterministic',
  name?: string,
): FlowNode {
  const complexity = bigOFromClass(cls);
  return mockNode('leaf', [], {
    result: {
      complexity,
      confidence,
      source,
      reasoning: `Mock leaf: ${complexity.notation}`,
    },
    metadata: name ? { calleeName: name } : {},
  });
}

function mockLeafWithLLMRuns(
  cls: BigOClass,
  confidence: number,
  llmRuns: Array<{ cls: BigOClass }>,
  name?: string,
): FlowNode {
  const complexity = bigOFromClass(cls);
  return mockNode('leaf', [], {
    result: {
      complexity,
      confidence,
      source: 'llm',
      reasoning: 'Mock LLM leaf',
      llmRuns: llmRuns.map((r) => ({
        complexity: bigOFromClass(r.cls),
        reasoning: 'run',
        rawResponse: '',
      })),
    },
    metadata: name ? { calleeName: name } : {},
  });
}

function mockTarget(
  functionName: string,
  flowTree: FlowNode,
): AnalysisTarget {
  return {
    functionName,
    filePath: 'test.ts',
    location: DEFAULT_LOCATION,
    flowTree,
  };
}

function mockRootNode(
  cls: BigOClass,
  confidence: number,
  children: FlowNode[],
  functionName?: string,
): FlowNode {
  const complexity = bigOFromClass(cls);
  return mockNode('sequential', children, {
    result: {
      complexity,
      confidence,
      source: 'aggregated',
      reasoning: `Root aggregated: ${complexity.notation}`,
    },
    metadata: functionName ? { functionName } : {},
  });
}

const defaultReporter = createReporter({
  threshold: BigOClass.ON2,
  confidenceMin: 0.7,
  format: 'tree',
});

describe('Reporter — exit code 0', () => {
  it('all functions below threshold and above confidence min → exit code 0', () => {
    const root1 = mockRootNode(BigOClass.ON, 0.9, [mockLeaf(BigOClass.ON, 0.9)], 'funcA');
    const root2 = mockRootNode(BigOClass.OLogN, 0.8, [mockLeaf(BigOClass.OLogN, 0.8)], 'funcB');

    const targets = [
      mockTarget('funcA', root1),
      mockTarget('funcB', root2),
    ];

    const report = defaultReporter.buildReport(targets);

    expect(report.exitCode).toBe(0);
    expect(report.entries).toHaveLength(2);
    expect(report.entries.every((e) => !e.exceedsThreshold)).toBe(true);
    expect(report.entries.every((e) => !e.lowConfidence)).toBe(true);
  });

  it('function AT the threshold boundary (equal) → exit code 0', () => {
    const root = mockRootNode(BigOClass.ON2, 0.9, [], 'funcExact');
    const report = defaultReporter.buildReport([mockTarget('funcExact', root)]);
    expect(report.exitCode).toBe(0);
    expect(report.entries[0].exceedsThreshold).toBe(false);
  });
});

describe('Reporter — exit code 1', () => {
  it('one function exceeds threshold → exit code 1', () => {
    const root = mockRootNode(BigOClass.ON3, 0.9, [], 'funcSlow');
    const report = defaultReporter.buildReport([mockTarget('funcSlow', root)]);

    expect(report.exitCode).toBe(1);
    expect(report.entries[0].exceedsThreshold).toBe(true);
  });

  it('mixed targets with one exceeding → exit code 1', () => {
    const rootOk = mockRootNode(BigOClass.ON, 0.9, [], 'funcOk');
    const rootBad = mockRootNode(BigOClass.ON3, 0.9, [], 'funcBad');

    const report = defaultReporter.buildReport([
      mockTarget('funcOk', rootOk),
      mockTarget('funcBad', rootBad),
    ]);

    expect(report.exitCode).toBe(1);
    expect(report.summary.thresholdExceeded).toBe(1);
  });
});

describe('Reporter — exit code 2', () => {
  it('low confidence but within threshold → exit code 2', () => {
    const root = mockRootNode(BigOClass.ON, 0.5, [], 'funcLowConf');
    const report = defaultReporter.buildReport([mockTarget('funcLowConf', root)]);

    expect(report.exitCode).toBe(2);
    expect(report.entries[0].lowConfidence).toBe(true);
    expect(report.entries[0].exceedsThreshold).toBe(false);
  });

  it('confidence exactly at minimum → not low confidence', () => {
    const root = mockRootNode(BigOClass.ON, 0.7, [], 'funcExactConf');
    const report = defaultReporter.buildReport([mockTarget('funcExactConf', root)]);
    expect(report.entries[0].lowConfidence).toBe(false);
    expect(report.exitCode).toBe(0);
  });
});

describe('Reporter — exit code 3', () => {
  it('target with missing root result → exit code 3', () => {
    const root = mockNode('sequential', []);
    const report = defaultReporter.buildReport([mockTarget('funcNoResult', root)]);

    expect(report.exitCode).toBe(3);
    expect(report.summary.errors).toBe(1);
  });

  it('one ok and one missing result → exit code 3', () => {
    const rootOk = mockRootNode(BigOClass.ON, 0.9, [], 'funcOk');
    const rootMissing = mockNode('sequential', []);

    const report = defaultReporter.buildReport([
      mockTarget('funcOk', rootOk),
      mockTarget('funcMissing', rootMissing),
    ]);

    expect(report.exitCode).toBe(3);
    expect(report.summary.errors).toBe(1);
    expect(report.summary.totalFunctions).toBe(2);
  });
});

describe('Reporter — exit code priority', () => {
  it('threshold exceeded AND low confidence → exit code 1 (not 2)', () => {
    const root = mockRootNode(BigOClass.ON3, 0.4, [], 'funcBadAndLow');
    const report = defaultReporter.buildReport([mockTarget('funcBadAndLow', root)]);

    expect(report.exitCode).toBe(1);
    expect(report.entries[0].exceedsThreshold).toBe(true);
    expect(report.entries[0].lowConfidence).toBe(true);
  });

  it('threshold exceeded overrides error: threshold + error → exit code 1', () => {
    const rootBad = mockRootNode(BigOClass.O2N, 0.9, [], 'funcBad');
    const rootMissing = mockNode('sequential', []);

    const report = defaultReporter.buildReport([
      mockTarget('funcBad', rootBad),
      mockTarget('funcMissing', rootMissing),
    ]);

    expect(report.exitCode).toBe(1);
  });

  it('low confidence overrides error: low conf + error → exit code 2', () => {
    const rootLow = mockRootNode(BigOClass.ON, 0.3, [], 'funcLow');
    const rootMissing = mockNode('sequential', []);

    const report = defaultReporter.buildReport([
      mockTarget('funcLow', rootLow),
      mockTarget('funcMissing', rootMissing),
    ]);

    expect(report.exitCode).toBe(2);
  });
});

describe('Reporter — tree format characters', () => {
  it('tree output contains tree branch characters', () => {
    const childLeaf = mockLeaf(BigOClass.OLogN, 1.0, 'deterministic', 'findUser');
    const rootNode = mockRootNode(BigOClass.ON2, 0.72, [childLeaf], 'getUserOrders');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([mockTarget('getUserOrders', rootNode)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('└──');
    expect(output).toContain('getUserOrders');
  });

  it('multi-child tree contains ├── characters', () => {
    const child1 = mockLeaf(BigOClass.OLogN, 1.0, 'deterministic', 'findUser');
    const child2 = mockLeaf(BigOClass.ON, 0.8, 'llm', 'db.query');
    const child3 = mockLeaf(BigOClass.ON, 0.6, 'llm', 'calculateDiscount');

    const seqNode = mockNode('sequential', [child1, child2, child3], {
      result: {
        complexity: bigOFromClass(BigOClass.ON),
        confidence: 0.6,
        source: 'aggregated',
        reasoning: 'seq',
      },
    });

    const rootNode = mockRootNode(BigOClass.ON2, 0.72, [seqNode], 'getUserOrders');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([mockTarget('getUserOrders', rootNode)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('├──');
    expect(output).toContain('└──');
    expect(output).toContain('findUser');
    expect(output).toContain('db.query');
    expect(output).toContain('calculateDiscount');
  });

  it('nested tree produces │ continuation characters', () => {
    const grandchild = mockLeaf(BigOClass.ON, 0.9, 'deterministic', 'inner');
    const seqA = mockNode('sequential', [grandchild], {
      result: {
        complexity: bigOFromClass(BigOClass.ON),
        confidence: 0.9,
        source: 'aggregated',
        reasoning: 'seqA',
      },
    });
    const leafB = mockLeaf(BigOClass.O1, 1.0, 'deterministic', 'quick');

    const root = mockNode('sequential', [seqA, leafB], {
      result: {
        complexity: bigOFromClass(BigOClass.ON),
        confidence: 0.9,
        source: 'aggregated',
        reasoning: 'root',
      },
      metadata: { functionName: 'myFunc' },
    });

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([mockTarget('myFunc', root)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('├──');
    expect(output).toContain('└──');
    expect(output).toContain('│');
  });
});

describe('Reporter — EXCEEDS THRESHOLD in tree format', () => {
  it('EXCEEDS THRESHOLD appears for functions above threshold', () => {
    const root = mockRootNode(BigOClass.ON3, 0.9, [], 'slowFunc');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([mockTarget('slowFunc', root)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('EXCEEDS THRESHOLD');
  });

  it('EXCEEDS THRESHOLD does NOT appear for functions within threshold', () => {
    const root = mockRootNode(BigOClass.ON, 0.9, [], 'fastFunc');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([mockTarget('fastFunc', root)]);
    const output = reporter.formatReport(report);

    expect(output).not.toContain('EXCEEDS THRESHOLD');
  });
});

describe('Reporter — JSON format', () => {
  it('produces valid JSON', () => {
    const root = mockRootNode(BigOClass.ON, 0.9, [], 'funcA');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'json',
    });

    const report = reporter.buildReport([mockTarget('funcA', root)]);
    const output = reporter.formatReport(report);

    let parsed: unknown;
    expect(() => { parsed = JSON.parse(output); }).not.toThrow();

    const parsedReport = parsed as { entries: unknown[]; exitCode: number; summary: unknown };
    expect(parsedReport).toHaveProperty('entries');
    expect(parsedReport).toHaveProperty('exitCode');
    expect(parsedReport).toHaveProperty('summary');
    expect(Array.isArray(parsedReport.entries)).toBe(true);
    expect(parsedReport.exitCode).toBe(0);
  });

  it('JSON output contains function name and complexity', () => {
    const root = mockRootNode(BigOClass.ON2, 0.9, [], 'processData');

    const reporter = createReporter({
      threshold: BigOClass.ON3,
      confidenceMin: 0.7,
      format: 'json',
    });

    const report = reporter.buildReport([mockTarget('processData', root)]);
    const output = reporter.formatReport(report);
    const parsed = JSON.parse(output) as { entries: Array<{ functionName: string; complexity: { notation: string } }> };

    expect(parsed.entries[0].functionName).toBe('processData');
    expect(parsed.entries[0].complexity.notation).toBe('O(n²)');
  });
});

describe('Reporter — Markdown format', () => {
  it('contains table header', () => {
    const root = mockRootNode(BigOClass.ON, 0.9, [], 'funcA');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'markdown',
    });

    const report = reporter.buildReport([mockTarget('funcA', root)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('| Function | Complexity | Confidence | Status |');
    expect(output).toContain('|----------|');
  });

  it('contains row for each function', () => {
    const root1 = mockRootNode(BigOClass.ON, 1.0, [], 'funcA');
    const root2 = mockRootNode(BigOClass.ON3, 0.9, [], 'funcB');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'markdown',
    });

    const report = reporter.buildReport([
      mockTarget('funcA', root1),
      mockTarget('funcB', root2),
    ]);
    const output = reporter.formatReport(report);

    expect(output).toContain('funcA');
    expect(output).toContain('funcB');
    expect(output).toContain('✅ OK');
    expect(output).toContain('⚠️ EXCEEDS THRESHOLD');
  });

  it('shows processData as OK', () => {
    const root = mockRootNode(BigOClass.ON, 1.0, [], 'processData');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'markdown',
    });

    const report = reporter.buildReport([mockTarget('processData', root)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('| processData | O(n) | 1.00 | ✅ OK |');
  });
});

describe('Reporter — summary counts', () => {
  it('counts totalFunctions correctly', () => {
    const root1 = mockRootNode(BigOClass.ON, 0.9, [], 'a');
    const root2 = mockRootNode(BigOClass.ON2, 0.9, [], 'b');
    const root3 = mockRootNode(BigOClass.ON3, 0.9, [], 'c');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([
      mockTarget('a', root1),
      mockTarget('b', root2),
      mockTarget('c', root3),
    ]);

    expect(report.summary.totalFunctions).toBe(3);
    expect(report.summary.thresholdExceeded).toBe(1);
    expect(report.summary.lowConfidence).toBe(0);
    expect(report.summary.errors).toBe(0);
  });

  it('counts thresholdExceeded correctly', () => {
    const roots = [
      mockRootNode(BigOClass.ON3, 0.9, [], 'bad1'),
      mockRootNode(BigOClass.O2N, 0.9, [], 'bad2'),
      mockRootNode(BigOClass.ON, 0.9, [], 'good'),
    ];

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport(roots.map((r, i) => mockTarget(`func${i}`, r)));

    expect(report.summary.thresholdExceeded).toBe(2);
  });

  it('counts lowConfidence correctly', () => {
    const roots = [
      mockRootNode(BigOClass.ON, 0.3, [], 'lowConf1'),
      mockRootNode(BigOClass.ON, 0.5, [], 'lowConf2'),
      mockRootNode(BigOClass.ON, 0.9, [], 'highConf'),
    ];

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport(roots.map((r, i) => mockTarget(`func${i}`, r)));

    expect(report.summary.lowConfidence).toBe(2);
    expect(report.summary.thresholdExceeded).toBe(0);
  });

  it('counts errors correctly', () => {
    const rootOk = mockRootNode(BigOClass.ON, 0.9, [], 'ok');
    const rootMissing1 = mockNode('sequential', []);
    const rootMissing2 = mockNode('leaf', []);

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([
      mockTarget('ok', rootOk),
      mockTarget('missing1', rootMissing1),
      mockTarget('missing2', rootMissing2),
    ]);

    expect(report.summary.errors).toBe(2);
    expect(report.summary.totalFunctions).toBe(3);
  });
});

describe('Reporter — source indicators', () => {
  it('[deterministic] appears for deterministic leaf nodes', () => {
    const child = mockLeaf(BigOClass.ON, 1.0, 'deterministic', 'sortItems');
    const root = mockRootNode(BigOClass.ON, 1.0, [child], 'myFunc');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([mockTarget('myFunc', root)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('[deterministic]');
  });

  it('[llm: X/Y] appears for LLM leaf nodes with runs', () => {
    const child = mockLeafWithLLMRuns(
      BigOClass.ON,
      0.8,
      [{ cls: BigOClass.ON }, { cls: BigOClass.ON }, { cls: BigOClass.ON2 }],
      'queryDb',
    );
    const root = mockRootNode(BigOClass.ON, 0.8, [child], 'myFunc');

    const reporter = createReporter({
      threshold: BigOClass.ON2,
      confidenceMin: 0.7,
      format: 'tree',
    });

    const report = reporter.buildReport([mockTarget('myFunc', root)]);
    const output = reporter.formatReport(report);

    expect(output).toContain('[llm: 2/3]');
  });
});

describe('Reporter — empty targets', () => {
  it('no targets → empty report with exit code 0', () => {
    const report = defaultReporter.buildReport([]);

    expect(report.exitCode).toBe(0);
    expect(report.entries).toHaveLength(0);
    expect(report.summary.totalFunctions).toBe(0);
    expect(report.summary.errors).toBe(0);
  });

  it('formatReport with empty report produces empty/minimal output', () => {
    const report = defaultReporter.buildReport([]);
    const output = defaultReporter.formatReport(report);
    expect(typeof output).toBe('string');
  });
});
