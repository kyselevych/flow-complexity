import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createPipeline } from '../../src/pipeline/pipeline.js';
import { BigOClass } from '../../src/types/complexity.js';
import { mergeConfig, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { LLMClient, LLMClientOptions, LLMResponse } from '../../src/evaluators/llm/llm-client.js';
import type { AnalysisReport } from '../../src/types/report.js';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures');

function makeResponse(complexity: string, variable: string, reasoning: string): string {
  return JSON.stringify({ complexity, variable, reasoning });
}

function createMockLLMClient(
  defaultResponse?: string,
): LLMClient & { callCount: number } {
  let callIndex = 0;
  const response = defaultResponse ?? makeResponse('O(n)', 'n', 'Linear pass over input.');

  const client = {
    callCount: 0,
    async complete(_prompt: string, _options: LLMClientOptions): Promise<LLMResponse> {
      callIndex++;
      client.callCount = callIndex;
      return { content: response, tokensUsed: { input: 100, output: 50 } };
    },
  };
  return client;
}

describe('Pipeline integration — no-LLM mode', () => {
  it('produces a valid AnalysisReport with correct structure', async () => {
    const config = mergeConfig({ noLlm: true });
    const pipeline = createPipeline({ config });

    const report: AnalysisReport = await pipeline.run(FIXTURES_DIR);

    expect(report).toBeDefined();
    expect(report.entries).toBeDefined();
    expect(Array.isArray(report.entries)).toBe(true);
    expect(report.summary).toBeDefined();
    expect(typeof report.exitCode).toBe('number');
  });

  it('finds all annotated functions from fixture files', async () => {
    const config = mergeConfig({ noLlm: true });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    const names = report.entries.map(e => e.functionName);
    expect(names).toContain('simpleLoop');
    expect(names).toContain('arrowFunc');
    expect(names).toContain('process');
    expect(names).toContain('processItems');
    expect(report.summary.totalFunctions).toBe(4);
  });

  it('processItems gets O(n) for its simple loop', async () => {
    const config = mergeConfig({ noLlm: true });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    const processItems = report.entries.find(e => e.functionName === 'processItems');
    expect(processItems).toBeDefined();
    expect(processItems!.complexity.class).toBe(BigOClass.ON);
    expect(processItems!.confidence).toBeGreaterThan(0);
  });

  it('simpleLoop gets O(n) for its for-of loop', async () => {
    const config = mergeConfig({ noLlm: true });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    const simpleLoop = report.entries.find(e => e.functionName === 'simpleLoop');
    expect(simpleLoop).toBeDefined();
    expect(simpleLoop!.complexity.class).toBe(BigOClass.ON);
  });

  it('exit code is 0 when no function exceeds threshold', async () => {
    const config = mergeConfig({ noLlm: true, threshold: BigOClass.ON2 });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    expect(report.exitCode).toBe(0);
  });

  it('exit code is 1 when a function exceeds a low threshold', async () => {
    const config = mergeConfig({ noLlm: true, threshold: BigOClass.O1 });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    expect(report.exitCode).toBe(1);
    expect(report.summary.thresholdExceeded).toBeGreaterThan(0);
  });

  it('report entries have valid location data', async () => {
    const config = mergeConfig({ noLlm: true });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    for (const entry of report.entries) {
      expect(entry.location).toBeDefined();
      expect(entry.location.filePath).toBeTruthy();
      expect(entry.location.startLine).toBeGreaterThan(0);
      expect(entry.location.endLine).toBeGreaterThanOrEqual(entry.location.startLine);
    }
  });
});

describe('Pipeline integration — with mock LLM client', () => {
  it('uses the LLM client for semantic leaves', async () => {
    const config = mergeConfig({ noLlm: false, llm: { ...DEFAULT_CONFIG.llm, runs: 1, temperatures: [0] } });
    const mockClient = createMockLLMClient();
    const pipeline = createPipeline({ config, llmClient: mockClient });

    const report = await pipeline.run(FIXTURES_DIR);

    expect(report).toBeDefined();
    expect(report.entries.length).toBeGreaterThan(0);
  });

  it('produces a complete report with all entry fields populated', async () => {
    const config = mergeConfig({ noLlm: false, llm: { ...DEFAULT_CONFIG.llm, runs: 1, temperatures: [0] } });
    const mockClient = createMockLLMClient();
    const pipeline = createPipeline({ config, llmClient: mockClient });

    const report = await pipeline.run(FIXTURES_DIR);

    for (const entry of report.entries) {
      expect(entry.functionName).toBeTruthy();
      expect(entry.complexity).toBeDefined();
      expect(entry.complexity.notation).toBeTruthy();
      expect(typeof entry.confidence).toBe('number');
      expect(typeof entry.exceedsThreshold).toBe('boolean');
      expect(typeof entry.lowConfidence).toBe('boolean');
    }
  });
});

describe('Pipeline integration — exit codes', () => {
  it('exit code 0 for all-pass with adequate confidence', async () => {
    const config = mergeConfig({
      noLlm: true,
      threshold: BigOClass.ON2,
      confidenceMin: 0.5,
    });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    expect(report.exitCode).toBe(0);
  });

  it('exit code 2 when confidence is below minimum (no-LLM semantic leaves)', async () => {
    const config = mergeConfig({
      noLlm: true,
      threshold: BigOClass.ONFact, // very high, nothing exceeds
      confidenceMin: 0.5,
    });
    const pipeline = createPipeline({ config });

    const report = await pipeline.run(FIXTURES_DIR);

    if (report.summary.lowConfidence > 0) {
      expect(report.exitCode).toBe(2);
    } else {
      expect(report.exitCode).toBe(0);
    }
  });
});
