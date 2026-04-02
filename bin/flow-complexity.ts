#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import { createPipeline } from '../src/pipeline/pipeline.js';
import { createAnthropicClient } from '../src/evaluators/llm/anthropic-client.js';
import { mergeConfig, DEFAULT_CONFIG } from '../src/config/defaults.js';
import { parseComplexityString } from '../src/complexity/complexity-math.js';
import { createReporter } from '../src/pipeline/reporter.js';
import { setGlobalLogLevel } from '../src/util/logger.js';
import type { AnalysisConfig } from '../src/types/config.js';

const program = new Command();

program
  .name('flow-complexity')
  .description('Static Big-O complexity analyzer for TypeScript projects')
  .version('1.0.0');

program
  .command('analyze <project-path>')
  .description('Analyze the complexity of a TypeScript project')
  .option(
    '--threshold <complexity>',
    'Alert threshold (e.g. "O(n^2)")',
    'O(n^2)',
  )
  .option(
    '--llm-runs <N>',
    'Number of LLM consensus runs',
    String(DEFAULT_CONFIG.llm.runs),
  )
  .option(
    '--llm-provider <provider>',
    'LLM provider (anthropic)',
    DEFAULT_CONFIG.llm.provider,
  )
  .option(
    '--llm-model <model>',
    'LLM model to use',
    DEFAULT_CONFIG.llm.model,
  )
  .option(
    '--confidence-min <float>',
    'Minimum confidence threshold to trust (0-1)',
    String(DEFAULT_CONFIG.confidenceMin),
  )
  .option(
    '--output <format>',
    'Output format: tree | json | markdown',
    DEFAULT_CONFIG.output,
  )
  .option(
    '--no-llm',
    'Deterministic-only mode (skip LLM evaluation)',
  )
  .option(
    '--verbose',
    'Show detailed logs and evaluation method labels',
  )
  .action(async (projectPath: string, options: {
    threshold: string;
    llmRuns: string;
    llmProvider: string;
    llmModel: string;
    confidenceMin: string;
    output: string;
    llm: boolean;
    verbose: boolean;
  }) => {
    if (options.verbose) {
      setGlobalLogLevel('info');
    }
    if (!existsSync(projectPath)) {
      process.stderr.write(`Error: project path does not exist: ${projectPath}\n`);
      process.exit(3);
    }

    const thresholdClass = parseComplexityString(options.threshold);

    const confidenceMin = parseFloat(options.confidenceMin);
    if (Number.isNaN(confidenceMin) || confidenceMin < 0 || confidenceMin > 1) {
      process.stderr.write(`Error: --confidence-min must be a number between 0 and 1, got "${options.confidenceMin}"\n`);
      process.exit(3);
    }

    const llmRuns = parseInt(options.llmRuns, 10);
    if (Number.isNaN(llmRuns) || llmRuns < 1 || !Number.isInteger(llmRuns)) {
      process.stderr.write(`Error: --llm-runs must be a positive integer, got "${options.llmRuns}"\n`);
      process.exit(3);
    }

    const outputFormat = options.output as 'tree' | 'json' | 'markdown';
    if (!['tree', 'json', 'markdown'].includes(outputFormat)) {
      process.stderr.write(`Error: invalid output format "${options.output}". Must be one of: tree, json, markdown\n`);
      process.exit(3);
    }

    // Determine noLlm: commander sets options.llm = false when --no-llm is passed
    const noLlm = options.llm === false;

    const verbose = options.verbose ?? false;

    const configOverrides: Partial<AnalysisConfig> = {
      threshold: thresholdClass,
      confidenceMin,
      output: outputFormat,
      noLlm,
      verbose,
      llm: {
        ...DEFAULT_CONFIG.llm,
        provider: options.llmProvider,
        model: options.llmModel,
        runs: llmRuns,
      },
    };

    const config = mergeConfig(configOverrides);

    let llmClient;
    if (!noLlm) {
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        process.stderr.write('Warning: ANTHROPIC_API_KEY is not set. LLM calls will fail.\n');
      }
      llmClient = createAnthropicClient(apiKey);
    }

    const pipeline = createPipeline({ config, llmClient });

    try {
      const report = await pipeline.run(projectPath);

      const reporter = createReporter({
        threshold: config.threshold,
        confidenceMin: config.confidenceMin,
        format: config.output,
        verbose: config.verbose,
      });

      const formatted = reporter.formatReport(report);
      process.stdout.write(formatted + '\n');

      process.exit(report.exitCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(3);
    }
  });

program.parse(process.argv);
