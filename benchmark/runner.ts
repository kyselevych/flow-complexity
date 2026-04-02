import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createPipeline } from '../src/pipeline/pipeline.js';
import { mergeConfig } from '../src/config/defaults.js';
import { BigOClass } from '../src/types/complexity.js';
import { createAnthropicClient } from '../src/evaluators/llm/anthropic-client.js';

export interface GroundTruthEntry {
  complexity: string;
  class: number;
}

export interface GroundTruth {
  deterministic: Record<string, GroundTruthEntry>;
  semantic: Record<string, GroundTruthEntry>;
}

export interface BenchmarkResult {
  functionName: string;
  expected: BigOClass;
  actual: BigOClass;
  expectedNotation: string;
  actualNotation: string;
  confidence: number;
  correct: boolean;
  source: 'deterministic' | 'llm' | 'aggregated';
  category: 'deterministic' | 'semantic';
}

export interface BenchmarkReport {
  results: BenchmarkResult[];
  metrics: {
    accuracy: number;
    deterministicAccuracy: number;
    semanticAccuracy: number;
    precisionAtConfidence: Record<string, number>;
    confusionMatrix: Record<string, Record<string, number>>;
    totalTokens: { input: number; output: number };
    runDurationMs: number;
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadGroundTruth(): GroundTruth {
  const gt = fs.readFileSync(path.join(__dirname, 'ground-truth.json'), 'utf-8');
  return JSON.parse(gt) as GroundTruth;
}

function buildConfusionMatrix(
  results: BenchmarkResult[],
): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const r of results) {
    const expected = r.expectedNotation;
    const actual = r.actualNotation;
    if (!matrix[expected]) matrix[expected] = {};
    matrix[expected][actual] = (matrix[expected][actual] ?? 0) + 1;
  }
  return matrix;
}

function computePrecisionAtConfidence(
  results: BenchmarkResult[],
  thresholds: number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of thresholds) {
    const subset = results.filter((r) => r.confidence >= t);
    if (subset.length === 0) {
      out[t.toFixed(1)] = 0;
    } else {
      const correct = subset.filter((r) => r.correct).length;
      out[t.toFixed(1)] = correct / subset.length;
    }
  }
  return out;
}

export async function runBenchmark(
  options: { noLlm?: boolean } = {},
): Promise<BenchmarkReport> {
  const startMs = Date.now();
  const groundTruth = loadGroundTruth();

  const config = mergeConfig({
    noLlm: options.noLlm ?? false,
    output: 'json',
    threshold: BigOClass.ONFact,
  });

  const noLlm = options.noLlm ?? false;
  const llmClient = noLlm ? undefined : createAnthropicClient(config.llm.apiKey);
  const pipeline = createPipeline({ config, llmClient });

  const suiteDir = path.join(__dirname, 'suite');

  const allResults: BenchmarkResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const category of ['deterministic', 'semantic'] as const) {
    const categoryDir = path.join(suiteDir, category);
    const report = await pipeline.run(categoryDir);

    const gtCategory = groundTruth[category];

    for (const entry of report.entries) {
      const gt = gtCategory[entry.functionName];
      if (!gt) {
        console.warn(
          `[benchmark] No ground truth for ${category}/${entry.functionName} — skipping`,
        );
        continue;
      }

      const expected = gt.class as BigOClass;
      const actual = entry.complexity.class;

      allResults.push({
        functionName: entry.functionName,
        expected,
        actual,
        expectedNotation: gt.complexity,
        actualNotation: entry.complexity.notation,
        confidence: entry.confidence,
        correct: expected === actual,
        source: entry.confidence >= 0.9 ? 'deterministic' : 'aggregated',
        category,
      });
    }
  }

  totalInputTokens = 0;
  totalOutputTokens = 0;

  const deterministicResults = allResults.filter((r) => r.category === 'deterministic');
  const semanticResults = allResults.filter((r) => r.category === 'semantic');

  const accuracy =
    allResults.length > 0
      ? allResults.filter((r) => r.correct).length / allResults.length
      : 0;

  const deterministicAccuracy =
    deterministicResults.length > 0
      ? deterministicResults.filter((r) => r.correct).length / deterministicResults.length
      : 0;

  const semanticAccuracy =
    semanticResults.length > 0
      ? semanticResults.filter((r) => r.correct).length / semanticResults.length
      : 0;

  const precisionAtConfidence = computePrecisionAtConfidence(allResults, [
    0.5, 0.6, 0.7, 0.8, 0.9, 1.0,
  ]);

  const confusionMatrix = buildConfusionMatrix(allResults);

  return {
    results: allResults,
    metrics: {
      accuracy,
      deterministicAccuracy,
      semanticAccuracy,
      precisionAtConfidence,
      confusionMatrix,
      totalTokens: { input: totalInputTokens, output: totalOutputTokens },
      runDurationMs: Date.now() - startMs,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noLlm = args.includes('--no-llm');

  console.log(`[benchmark] Starting benchmark suite (noLlm=${noLlm})...`);

  const report = await runBenchmark({ noLlm });

  console.log('\n=== Benchmark Results ===\n');
  console.log(`Overall accuracy:       ${(report.metrics.accuracy * 100).toFixed(1)}%`);
  console.log(
    `Deterministic accuracy: ${(report.metrics.deterministicAccuracy * 100).toFixed(1)}%`,
  );
  console.log(`Semantic accuracy:      ${(report.metrics.semanticAccuracy * 100).toFixed(1)}%`);
  console.log(`Run duration:           ${report.metrics.runDurationMs}ms`);

  console.log('\n--- Precision @ Confidence ---');
  for (const [threshold, precision] of Object.entries(report.metrics.precisionAtConfidence)) {
    const subset = report.results.filter((r) => r.confidence >= parseFloat(threshold));
    console.log(
      `  >= ${threshold}: ${(precision * 100).toFixed(1)}% (${subset.length} functions)`,
    );
  }

  console.log('\n--- Per-Function Results ---');
  console.log(
    `${'Function'.padEnd(28)} ${'Expected'.padEnd(12)} ${'Actual'.padEnd(12)} ${'Conf'.padEnd(6)} ${'OK?'}`,
  );
  console.log('-'.repeat(72));
  for (const r of report.results) {
    const tick = r.correct ? 'YES' : 'NO ';
    console.log(
      `${r.functionName.padEnd(28)} ${r.expectedNotation.padEnd(12)} ${r.actualNotation.padEnd(12)} ${r.confidence.toFixed(2).padEnd(6)} ${tick}`,
    );
  }

  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'benchmark-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n[benchmark] Report written to ${outPath}`);
}

main().catch((err) => {
  console.error('[benchmark] Fatal error:', err);
  process.exit(1);
});
