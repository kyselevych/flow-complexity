import { Project } from 'ts-morph';
import { AnalysisConfig } from '../types/config.js';
import { AnalysisReport } from '../types/report.js';
import { AnalysisTarget } from '../types/flow-graph.js';
import { LLMClient } from '../evaluators/llm/llm-client.js';
import { createScanner } from './scanner.js';
import { createCallGraphBuilder } from './call-graph-builder.js';
import { createLeafClassifier } from './leaf-classifier.js';
import { createComplexityEvaluator } from './complexity-evaluator.js';
import { createAggregator } from './aggregator.js';
import { createReporter } from './reporter.js';
import { createWholeFunctionEvaluator } from './whole-function-evaluator.js';
import { createMemoCache } from '../cache/memo-cache.js';
import { extractFunctionSource } from '../util/source-extract.js';
import { createLogger } from '../util/logger.js';

export interface PipelineOptions {
  readonly config: AnalysisConfig;
  readonly llmClient?: LLMClient;  // injected, undefined if --no-llm
}

export interface Pipeline {
  run(projectPath: string): Promise<AnalysisReport>;
}

export function createPipeline(options: PipelineOptions): Pipeline {
  const { config, llmClient } = options;
  const logger = createLogger({ prefix: 'pipeline' });

  return {
    async run(projectPath: string): Promise<AnalysisReport> {
      logger.info(`Scanning project at ${projectPath}...`);
      const scanner = createScanner({ projectPath });
      const scanResults = scanner.scan();
      logger.info(`Found ${scanResults.length} annotated functions`);

      // The scanner creates its own Project internally; the call-graph builder
      // needs a separate instance so it can resolve cross-file call targets.
      const project = new Project({
        tsConfigFilePath: projectPath.endsWith('tsconfig.json')
          ? projectPath
          : `${projectPath}/tsconfig.json`,
        skipAddingFilesFromTsConfig: false,
      });

      const callGraphBuilder = createCallGraphBuilder({
        project,
        maxInlineDepth: config.maxInlineDepth,
      });

      const leafClassifier = createLeafClassifier();

      const cache = createMemoCache();
      const complexityEvaluator = createComplexityEvaluator({
        llmClient,
        llmConfig: config.llm,
        cache,
        noLlm: config.noLlm,
      });

      const aggregator = createAggregator();

      const wholeFunctionEvaluator = (llmClient && !config.noLlm)
        ? createWholeFunctionEvaluator({ llmClient, llmConfig: config.llm, cache })
        : undefined;

      const reporter = createReporter({
        threshold: config.threshold,
        confidenceMin: config.confidenceMin,
        format: config.output,
        verbose: config.verbose ?? false,
      });

      const targets: AnalysisTarget[] = [];

      for (const scanResult of scanResults) {
        logger.info(`Building flow tree for ${scanResult.functionName}...`);
        const target = callGraphBuilder.buildFlowTree(scanResult);

        const classification = leafClassifier.classify(target.flowTree);
        logger.info(
          `Classifying leaves: ${classification.deterministicCount} deterministic, ${classification.semanticCount} semantic`,
        );

        logger.info('Evaluating complexity...');
        await complexityEvaluator.evaluateLeaves(classification);

        logger.info('Aggregating results...');
        const rootResult = aggregator.aggregate(target.flowTree, scanResult.declaredInputVariable);

        if (wholeFunctionEvaluator && rootResult.confidence < config.confidenceMin) {
          logger.info(`Confidence ${rootResult.confidence} < ${config.confidenceMin}, invoking LLM fallback...`);
          try {
            const functionSource = extractFunctionSource(scanResult.astNode);
            const llmResult = await wholeFunctionEvaluator.evaluate(
              functionSource,
              scanResult.functionName,
              scanResult.declaredInputVariable,
            );
            (target.flowTree as { result?: typeof rootResult }).result = llmResult;
          } catch {
            logger.warn(`LLM fallback failed for "${scanResult.functionName}", keeping aggregated result`);
            (target.flowTree as { result?: typeof rootResult }).result = rootResult;
          }
        } else {
          (target.flowTree as { result?: typeof rootResult }).result = rootResult;
        }

        targets.push(target);
      }

      const report = reporter.buildReport(targets);
      logger.info(`Analysis complete. Exit code: ${report.exitCode}`);

      return report;
    },
  };
}
