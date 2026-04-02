import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config/defaults.js';
import { BigOClass } from '../../src/types/complexity.js';

describe('DEFAULT_CONFIG', () => {
  it('has threshold ON2', () => {
    expect(DEFAULT_CONFIG.threshold).toBe(BigOClass.ON2);
  });

  it('has confidenceMin 0.5', () => {
    expect(DEFAULT_CONFIG.confidenceMin).toBe(0.5);
  });

  it('has output "tree"', () => {
    expect(DEFAULT_CONFIG.output).toBe('tree');
  });

  it('has noLlm false', () => {
    expect(DEFAULT_CONFIG.noLlm).toBe(false);
  });

  it('has maxInlineDepth 3', () => {
    expect(DEFAULT_CONFIG.maxInlineDepth).toBe(3);
  });

  it('llm provider is anthropic', () => {
    expect(DEFAULT_CONFIG.llm.provider).toBe('anthropic');
  });

  it('llm model is claude-sonnet-4-20250514', () => {
    expect(DEFAULT_CONFIG.llm.model).toBe('claude-sonnet-4-20250514');
  });

  it('llm runs is 3', () => {
    expect(DEFAULT_CONFIG.llm.runs).toBe(3);
  });

  it('llm temperatures has 3 values', () => {
    expect(DEFAULT_CONFIG.llm.temperatures).toHaveLength(3);
  });

  it('llm maxTokens is 1024', () => {
    expect(DEFAULT_CONFIG.llm.maxTokens).toBe(1024);
  });
});

describe('mergeConfig', () => {
  it('returns defaults when called with empty object', () => {
    const cfg = mergeConfig({});
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('overrides top-level scalar field', () => {
    const cfg = mergeConfig({ confidenceMin: 0.8 });
    expect(cfg.confidenceMin).toBe(0.8);
  });

  it('preserves other top-level fields when one is overridden', () => {
    const cfg = mergeConfig({ threshold: BigOClass.ON });
    expect(cfg.output).toBe(DEFAULT_CONFIG.output);
    expect(cfg.noLlm).toBe(DEFAULT_CONFIG.noLlm);
  });

  it('overrides output format', () => {
    const cfg = mergeConfig({ output: 'json' });
    expect(cfg.output).toBe('json');
  });

  it('overrides noLlm flag', () => {
    const cfg = mergeConfig({ noLlm: true });
    expect(cfg.noLlm).toBe(true);
  });

  it('overrides maxInlineDepth', () => {
    const cfg = mergeConfig({ maxInlineDepth: 5 });
    expect(cfg.maxInlineDepth).toBe(5);
  });

  it('deep merges llm object — only overrides specified llm fields', () => {
    const cfg = mergeConfig({ llm: { runs: 5 } as never });
    expect(cfg.llm.runs).toBe(5);
    expect(cfg.llm.provider).toBe(DEFAULT_CONFIG.llm.provider);
    expect(cfg.llm.model).toBe(DEFAULT_CONFIG.llm.model);
    expect(cfg.llm.temperatures).toEqual(DEFAULT_CONFIG.llm.temperatures);
    expect(cfg.llm.maxTokens).toBe(DEFAULT_CONFIG.llm.maxTokens);
  });

  it('llm override with multiple fields merges correctly', () => {
    const cfg = mergeConfig({
      llm: { provider: 'openai', model: 'gpt-4o', runs: 1, temperatures: [0.7], maxTokens: 2048 },
    });
    expect(cfg.llm.provider).toBe('openai');
    expect(cfg.llm.model).toBe('gpt-4o');
    expect(cfg.llm.runs).toBe(1);
    expect(cfg.llm.maxTokens).toBe(2048);
  });

  it('does not mutate DEFAULT_CONFIG', () => {
    const originalThreshold = DEFAULT_CONFIG.threshold;
    mergeConfig({ threshold: BigOClass.O1 });
    expect(DEFAULT_CONFIG.threshold).toBe(originalThreshold);
  });

  it('returns a new object, not the same reference as DEFAULT_CONFIG', () => {
    const cfg = mergeConfig({});
    expect(cfg).not.toBe(DEFAULT_CONFIG);
  });
});
