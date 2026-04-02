import { describe, it, expect } from 'vitest';
import { buildComplexityPrompt } from '../../src/evaluators/llm/prompt-templates.js';
import { parseLLMResponse, toLLMRunResult } from '../../src/evaluators/llm/response-parser.js';
import { computeConsensus } from '../../src/evaluators/llm/consensus.js';
import { createMicroEvaluator } from '../../src/evaluators/llm/micro-evaluator.js';
import { LLMClient, LLMClientOptions, LLMResponse } from '../../src/evaluators/llm/llm-client.js';
import { BigOClass } from '../../src/types/complexity.js';
import { bigOFromClass } from '../../src/complexity/complexity-math.js';
import type { LLMRunResult } from '../../src/types/complexity.js';
import type { LLMConfig } from '../../src/types/config.js';

function createMockClient(responses: string[]): LLMClient & { callCount: number; lastOptions: LLMClientOptions[] } {
  let callIndex = 0;
  const lastOptions: LLMClientOptions[] = [];

  const client = {
    callCount: 0,
    lastOptions,
    async complete(prompt: string, options: LLMClientOptions): Promise<LLMResponse> {
      const response = responses[callIndex++ % responses.length];
      client.callCount = callIndex;
      lastOptions.push(options);
      return { content: response, tokensUsed: { input: 100, output: 50 } };
    },
  };

  return client;
}

function makeResponse(complexity: string, variable: string, reasoning: string): string {
  return JSON.stringify({ complexity, variable, reasoning });
}

function makeRunResult(cls: BigOClass, variable = 'n', reasoning = 'test reasoning'): LLMRunResult {
  return {
    complexity: bigOFromClass(cls, variable),
    reasoning,
    rawResponse: makeResponse('O(n)', variable, reasoning),
  };
}

const defaultConfig: LLMConfig = {
  provider: 'anthropic',
  model: 'claude-3-haiku-20240307',
  runs: 3,
  temperatures: [0, 0.5, 1.0],
  maxTokens: 512,
};

describe('buildComplexityPrompt', () => {
  it('includes function source in the prompt', () => {
    const prompt = buildComplexityPrompt({ functionSource: 'function foo() {}' });
    expect(prompt).toContain('function foo() {}');
  });

  it('includes caller context when provided', () => {
    const prompt = buildComplexityPrompt({
      functionSource: 'function foo() {}',
      callerContext: 'bar() at line 42',
    });
    expect(prompt).toContain('bar() at line 42');
  });

  it('uses default caller context when not provided', () => {
    const prompt = buildComplexityPrompt({ functionSource: 'function foo() {}' });
    expect(prompt).toContain('top-level analysis target');
  });

  it('includes input variable when provided', () => {
    const prompt = buildComplexityPrompt({
      functionSource: 'function foo(arr: number[]) {}',
      inputVariable: 'arr.length',
    });
    expect(prompt).toContain('arr.length');
  });

  it('uses default input variable description when not provided', () => {
    const prompt = buildComplexityPrompt({ functionSource: 'function foo() {}' });
    expect(prompt).toContain('determine from the code');
  });

  it('contains the required complexity class list', () => {
    const prompt = buildComplexityPrompt({ functionSource: 'function foo() {}' });
    expect(prompt).toContain('O(1)');
    expect(prompt).toContain('O(n^2)');
    expect(prompt).toContain('O(n!)');
  });

  it('instructs for strict JSON response', () => {
    const prompt = buildComplexityPrompt({ functionSource: 'function foo() {}' });
    expect(prompt).toContain('strict JSON');
  });
});

describe('parseLLMResponse', () => {
  it('parses valid JSON response', () => {
    const raw = makeResponse('O(n)', 'items.length', 'Single linear pass.');
    const result = parseLLMResponse(raw);
    expect(result.complexity).toBe('O(n)');
    expect(result.variable).toBe('items.length');
    expect(result.reasoning).toBe('Single linear pass.');
  });

  it('parses JSON wrapped in markdown code fences with json label', () => {
    const raw = '```json\n' + makeResponse('O(n^2)', 'n', 'Nested loop.') + '\n```';
    const result = parseLLMResponse(raw);
    expect(result.complexity).toBe('O(n^2)');
    expect(result.variable).toBe('n');
  });

  it('parses JSON wrapped in plain markdown code fences', () => {
    const raw = '```\n' + makeResponse('O(1)', 'n', 'Constant time.') + '\n```';
    const result = parseLLMResponse(raw);
    expect(result.complexity).toBe('O(1)');
  });

  it('throws on missing complexity field', () => {
    const raw = JSON.stringify({ variable: 'n', reasoning: 'test' });
    expect(() => parseLLMResponse(raw)).toThrow(/complexity/);
  });

  it('throws on missing variable field', () => {
    const raw = JSON.stringify({ complexity: 'O(n)', reasoning: 'test' });
    expect(() => parseLLMResponse(raw)).toThrow(/variable/);
  });

  it('throws on missing reasoning field', () => {
    const raw = JSON.stringify({ complexity: 'O(n)', variable: 'n' });
    expect(() => parseLLMResponse(raw)).toThrow(/reasoning/);
  });

  it('throws on invalid (non-JSON) response', () => {
    expect(() => parseLLMResponse('this is not json')).toThrow(/not valid JSON/);
  });

  it('throws when JSON is an array instead of an object', () => {
    expect(() => parseLLMResponse('[1, 2, 3]')).toThrow(/not an object/);
  });

  it('throws when JSON is null', () => {
    expect(() => parseLLMResponse('null')).toThrow(/not an object/);
  });

  it('throws when complexity field is not a string', () => {
    const raw = JSON.stringify({ complexity: 42, variable: 'n', reasoning: 'test' });
    expect(() => parseLLMResponse(raw)).toThrow(/complexity/);
  });
});

describe('toLLMRunResult', () => {
  it('correctly creates LLMRunResult from parsed response', () => {
    const parsed = { complexity: 'O(n)', variable: 'items.length', reasoning: 'Linear pass.' };
    const raw = JSON.stringify(parsed);
    const result = toLLMRunResult(parsed, raw);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.complexity.variable).toBe('items.length');
    expect(result.complexity.notation).toBe('O(n)');
    expect(result.reasoning).toBe('Linear pass.');
    expect(result.rawResponse).toBe(raw);
  });

  it('maps O(n^2) to BigOClass.ON2', () => {
    const parsed = { complexity: 'O(n^2)', variable: 'n', reasoning: 'Nested loop.' };
    const result = toLLMRunResult(parsed, '');
    expect(result.complexity.class).toBe(BigOClass.ON2);
  });

  it('maps O(1) to BigOClass.O1', () => {
    const parsed = { complexity: 'O(1)', variable: 'n', reasoning: 'Constant.' };
    const result = toLLMRunResult(parsed, '');
    expect(result.complexity.class).toBe(BigOClass.O1);
  });

  it('maps O(log n) to BigOClass.OLogN', () => {
    const parsed = { complexity: 'O(log n)', variable: 'n', reasoning: 'Binary search.' };
    const result = toLLMRunResult(parsed, '');
    expect(result.complexity.class).toBe(BigOClass.OLogN);
  });

  it('maps unknown complexity string to BigOClass.Unknown', () => {
    const parsed = { complexity: 'O(n^4)', variable: 'n', reasoning: 'Unusual.' };
    const result = toLLMRunResult(parsed, '');
    expect(result.complexity.class).toBe(BigOClass.Unknown);
  });
});

describe('computeConsensus', () => {
  it('unanimous: all runs return O(n) → confidence 1.0', () => {
    const runs: LLMRunResult[] = [
      makeRunResult(BigOClass.ON, 'n', 'Linear 1'),
      makeRunResult(BigOClass.ON, 'n', 'Linear 2'),
      makeRunResult(BigOClass.ON, 'n', 'Linear 3'),
    ];
    const result = computeConsensus(runs);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBe('llm');
    expect(result.llmRuns).toHaveLength(3);
  });

  it('majority: 2/3 return O(n), 1 returns O(n^2) → confidence ~0.667', () => {
    const runs: LLMRunResult[] = [
      makeRunResult(BigOClass.ON, 'n', 'Linear 1'),
      makeRunResult(BigOClass.ON, 'n', 'Linear 2'),
      makeRunResult(BigOClass.ON2, 'n', 'Quadratic'),
    ];
    const result = computeConsensus(runs);
    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(2 / 3, 5);
    expect(result.source).toBe('llm');
  });

  it('no majority: all different → confidence 1/N, result = max', () => {
    const runs: LLMRunResult[] = [
      makeRunResult(BigOClass.O1, 'n', 'Constant'),
      makeRunResult(BigOClass.ON, 'n', 'Linear'),
      makeRunResult(BigOClass.ON2, 'n', 'Quadratic'),
    ];
    const result = computeConsensus(runs);
    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBeCloseTo(1 / 3, 5);
    expect(result.source).toBe('llm');
  });

  it('single run → confidence 1.0', () => {
    const runs: LLMRunResult[] = [makeRunResult(BigOClass.ONLogN, 'n', 'Merge sort')];
    const result = computeConsensus(runs);
    expect(result.complexity.class).toBe(BigOClass.ONLogN);
    expect(result.confidence).toBe(1.0);
  });

  it('two runs with same class → confidence 1.0', () => {
    const runs: LLMRunResult[] = [
      makeRunResult(BigOClass.ON2, 'n', 'Quadratic 1'),
      makeRunResult(BigOClass.ON2, 'n', 'Quadratic 2'),
    ];
    const result = computeConsensus(runs);
    expect(result.confidence).toBe(1.0);
    expect(result.complexity.class).toBe(BigOClass.ON2);
  });

  it('two runs with different classes → no majority, confidence 0.5, result = max', () => {
    const runs: LLMRunResult[] = [
      makeRunResult(BigOClass.ON, 'n', 'Linear'),
      makeRunResult(BigOClass.ON2, 'n', 'Quadratic'),
    ];
    const result = computeConsensus(runs);
    // 1/2 is not strictly > 1, so no majority
    expect(result.confidence).toBeCloseTo(0.5, 5);
    expect(result.complexity.class).toBe(BigOClass.ON2);
  });

  it('combines all run reasonings in the result', () => {
    const runs: LLMRunResult[] = [
      makeRunResult(BigOClass.ON, 'n', 'First reasoning'),
      makeRunResult(BigOClass.ON, 'n', 'Second reasoning'),
    ];
    const result = computeConsensus(runs);
    expect(result.reasoning).toContain('First reasoning');
    expect(result.reasoning).toContain('Second reasoning');
  });

  it('throws on empty runs array', () => {
    expect(() => computeConsensus([])).toThrow();
  });

  it('includes llmRuns in result', () => {
    const runs: LLMRunResult[] = [
      makeRunResult(BigOClass.ON, 'n', 'Run 1'),
      makeRunResult(BigOClass.ON, 'n', 'Run 2'),
    ];
    const result = computeConsensus(runs);
    expect(result.llmRuns).toBeDefined();
    expect(result.llmRuns).toHaveLength(2);
  });
});

describe('createMicroEvaluator', () => {
  it('makes exactly N LLM calls (N = config.runs)', async () => {
    const mockClient = createMockClient([makeResponse('O(n)', 'n', 'Linear.')]);
    const evaluator = createMicroEvaluator({ client: mockClient, config: defaultConfig });

    await evaluator.evaluate('function foo(arr) { for (const x of arr) {} }');

    expect(mockClient.callCount).toBe(3);
  });

  it('passes configured temperatures to the client', async () => {
    const mockClient = createMockClient([makeResponse('O(n)', 'n', 'Linear.')]);
    const config: LLMConfig = { ...defaultConfig, runs: 3, temperatures: [0.0, 0.5, 1.0] };
    const evaluator = createMicroEvaluator({ client: mockClient, config });

    await evaluator.evaluate('function foo(arr) {}');

    expect(mockClient.lastOptions[0].temperature).toBe(0.0);
    expect(mockClient.lastOptions[1].temperature).toBe(0.5);
    expect(mockClient.lastOptions[2].temperature).toBe(1.0);
  });

  it('returns a ComplexityResult with source = llm', async () => {
    const mockClient = createMockClient([makeResponse('O(n)', 'n', 'Linear.')]);
    const evaluator = createMicroEvaluator({ client: mockClient, config: defaultConfig });

    const result = await evaluator.evaluate('function foo(arr) {}');

    expect(result.source).toBe('llm');
  });

  it('returns correct complexity class when all runs agree', async () => {
    const mockClient = createMockClient([makeResponse('O(n^2)', 'n', 'Nested loop.')]);
    const evaluator = createMicroEvaluator({ client: mockClient, config: defaultConfig });

    const result = await evaluator.evaluate('function foo(a, b) {}');

    expect(result.complexity.class).toBe(BigOClass.ON2);
    expect(result.confidence).toBe(1.0);
  });

  it('attaches llmRuns to the result', async () => {
    const mockClient = createMockClient([makeResponse('O(n)', 'n', 'Linear.')]);
    const evaluator = createMicroEvaluator({ client: mockClient, config: defaultConfig });

    const result = await evaluator.evaluate('function foo(arr) {}');

    expect(result.llmRuns).toBeDefined();
    expect(result.llmRuns!.length).toBe(3);
  });

  it('passes model and maxTokens from config', async () => {
    const mockClient = createMockClient([makeResponse('O(1)', 'n', 'Constant.')]);
    const config: LLMConfig = {
      ...defaultConfig,
      model: 'claude-3-sonnet-test',
      maxTokens: 1024,
      runs: 1,
      temperatures: [0.0],
    };
    const evaluator = createMicroEvaluator({ client: mockClient, config });

    await evaluator.evaluate('function foo() { return 42; }');

    expect(mockClient.lastOptions[0].model).toBe('claude-3-sonnet-test');
    expect(mockClient.lastOptions[0].maxTokens).toBe(1024);
  });

  it('passes caller context and input variable to the prompt', async () => {
    const capturedPrompts: string[] = [];
    const customClient: LLMClient = {
      async complete(prompt, _opts) {
        capturedPrompts.push(prompt);
        return { content: makeResponse('O(n)', 'n', 'test'), tokensUsed: { input: 10, output: 10 } };
      },
    };

    const config: LLMConfig = { ...defaultConfig, runs: 1, temperatures: [0] };
    const evaluator = createMicroEvaluator({ client: customClient, config });
    await evaluator.evaluate('function foo() {}', 'caller at line 5', 'items.length');

    expect(capturedPrompts[0]).toContain('caller at line 5');
    expect(capturedPrompts[0]).toContain('items.length');
  });

  it('handles majority consensus correctly in end-to-end flow', async () => {
    const responses = [
      makeResponse('O(n)', 'n', 'Linear 1.'),
      makeResponse('O(n)', 'n', 'Linear 2.'),
      makeResponse('O(n^2)', 'n', 'Quadratic.'),
    ];
    const mockClient = createMockClient(responses);
    const evaluator = createMicroEvaluator({ client: mockClient, config: defaultConfig });

    const result = await evaluator.evaluate('function foo(arr) {}');

    expect(result.complexity.class).toBe(BigOClass.ON);
    expect(result.confidence).toBeCloseTo(2 / 3, 5);
  });

  it('linearly spaces temperatures when config has fewer than runs entries', async () => {
    const mockClient = createMockClient([makeResponse('O(1)', 'n', 'Constant.')]);
    const config: LLMConfig = {
      ...defaultConfig,
      runs: 3,
      temperatures: [0.0, 1.0],  // only 2 entries for 3 runs
    };
    const evaluator = createMicroEvaluator({ client: mockClient, config });

    await evaluator.evaluate('function foo() {}');

    const temps = mockClient.lastOptions.map(o => o.temperature);
    expect(temps).toHaveLength(3);
    expect(temps[0]).toBeCloseTo(0.0, 5);
    expect(temps[1]).toBeCloseTo(0.5, 5);
    expect(temps[2]).toBeCloseTo(1.0, 5);
  });
});
