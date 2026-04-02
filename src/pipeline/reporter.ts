import pc from 'picocolors';
import { FlowNode } from '../types/flow-graph.js';
import { BigOClass } from '../types/complexity.js';
import { AnalysisReport, ExitCode, ReportEntry } from '../types/report.js';
import { AnalysisTarget } from '../types/flow-graph.js';
import { bigOCompare } from '../complexity/complexity-math.js';


export interface ReporterOptions {
  readonly threshold: BigOClass;
  readonly confidenceMin: number;
  readonly format: 'tree' | 'json' | 'markdown';
  readonly verbose?: boolean;
}

export interface Reporter {
  buildReport(targets: readonly AnalysisTarget[]): AnalysisReport;
  formatReport(report: AnalysisReport): string;
}

export function createReporter(options: ReporterOptions): Reporter {
  return {
    buildReport(targets: readonly AnalysisTarget[]): AnalysisReport {
      return buildReport(targets, options);
    },
    formatReport(report: AnalysisReport): string {
      return formatReport(report, options);
    },
  };
}


function buildReport(
  targets: readonly AnalysisTarget[],
  options: ReporterOptions,
): AnalysisReport {
  const entries: ReportEntry[] = [];
  let hasThresholdExceeded = false;
  let hasLowConfidence = false;
  let hasError = false;

  for (const target of targets) {
    const rootResult = target.flowTree.result;

    if (!rootResult) {
      hasError = true;
      entries.push({
        functionName: target.functionName,
        location: target.location,
        complexity: { class: BigOClass.Unknown, variable: 'n', notation: 'O(?)' },
        confidence: 0,
        exceedsThreshold: false,
        lowConfidence: false,
        treeOutput: undefined,
      });
      continue;
    }

    const exceedsThreshold = bigOCompare(rootResult.complexity.class, options.threshold) > 0;
    const lowConfidence = rootResult.confidence < options.confidenceMin;

    if (exceedsThreshold) hasThresholdExceeded = true;
    if (lowConfidence) hasLowConfidence = true;

    const treeOutput = renderTree(target.flowTree, options.threshold, options.confidenceMin, options.verbose ?? false);

    entries.push({
      functionName: target.functionName,
      location: target.location,
      complexity: rootResult.complexity,
      confidence: rootResult.confidence,
      exceedsThreshold,
      lowConfidence,
      treeOutput,
    });
  }

  let exitCode: ExitCode = 0;
  if (hasThresholdExceeded) {
    exitCode = 1;
  } else if (hasLowConfidence) {
    exitCode = 2;
  } else if (hasError) {
    exitCode = 3;
  }

  const thresholdExceeded = entries.filter((e) => e.exceedsThreshold).length;
  const lowConfidenceCount = entries.filter((e) => e.lowConfidence).length;
  const errorsCount = targets.filter((t) => !t.flowTree.result).length;

  return {
    entries,
    exitCode,
    summary: {
      totalFunctions: entries.length,
      thresholdExceeded,
      lowConfidence: lowConfidenceCount,
      errors: errorsCount,
    },
  };
}


const MAX_LABEL_LENGTH = 60;

function truncateLabel(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= MAX_LABEL_LENGTH) return singleLine;
  return singleLine.substring(0, MAX_LABEL_LENGTH - 3) + '...';
}


function renderTree(
  node: FlowNode,
  threshold: BigOClass,
  confidenceMin: number,
  verbose: boolean,
): string {
  const lines: string[] = [];
  renderNode(node, '', true, lines, threshold, confidenceMin, true, verbose);
  return lines.join('\n');
}

function renderNode(
  node: FlowNode,
  prefix: string,
  isLast: boolean,
  lines: string[],
  threshold: BigOClass,
  confidenceMin: number,
  isRoot: boolean,
  verbose: boolean,
): void {
  const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
  const childPrefix = isRoot ? '' : isLast ? '    ' : '│   ';

  const label = formatNodeLabel(node, threshold, confidenceMin, isRoot, verbose);
  lines.push(prefix + connector + label);

  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childIsLast = i === children.length - 1;
    renderNode(
      child,
      prefix + childPrefix,
      childIsLast,
      lines,
      threshold,
      confidenceMin,
      false,
      verbose,
    );
  }
}

function formatNodeLabel(
  node: FlowNode,
  threshold: BigOClass,
  confidenceMin: number,
  isRoot: boolean,
  verbose: boolean,
): string {
  const isNamedEntry = isRoot;
  const isStructural = !isNamedEntry && node.kind !== 'leaf';
  const result = node.result;

  let namePart: string;
  if (isStructural) {
    let kindLabel = `[${node.kind}`;
    if (node.kind === 'loop' && node.metadata.loopBound) {
      kindLabel += `: ${node.metadata.loopBound}`;
    } else if (node.kind === 'loop' && node.metadata.loopVariable) {
      kindLabel += `: order of ${node.metadata.loopVariable}`;
    }
    kindLabel += ']';
    namePart = pc.dim(kindLabel);
  } else {
    const name = isRoot
      ? (node.metadata.functionName ?? node.id)
      : (node.metadata.calleeName ?? node.metadata.expressionLabel ?? node.metadata.functionName ?? node.id);
    const displayName = isRoot
      ? name
      : truncateLabel(name.endsWith('()') ? name : `${name}()`);
    namePart = pc.bold(displayName);
  }

  if (!result) {
    // No result — just show the name (no confusing "(no result)")
    return namePart;
  }

  const notationPart = result.complexity.notation;

  const exceedsThreshold = bigOCompare(result.complexity.class, threshold) > 0;
  const lowConf = result.confidence < confidenceMin;

  let line: string;
  if (isStructural) {
    line = namePart + '  ' + pc.dim(notationPart);
  } else {
    const coloredNotation = exceedsThreshold
      ? pc.red(notationPart)
      : lowConf
      ? pc.yellow(notationPart)
      : pc.green(notationPart);

    line = namePart + '  ' + coloredNotation;

    // Show confidence only when it's not perfect
    if (result.confidence < 1.0) {
      line += '  ' + pc.dim(`confidence=${result.confidence.toFixed(2)}`);
    }

    // Show source labels only in verbose mode
    if (verbose) {
      if (result.source === 'deterministic') {
        line += '  ' + pc.dim('[deterministic]');
      } else if (result.source === 'llm') {
        const llmRuns = result.llmRuns;
        if (llmRuns && llmRuns.length > 0) {
          const agreeing = llmRuns.filter(
            (r) => r.complexity.class === result.complexity.class,
          ).length;
          line += '  ' + pc.dim(`[llm: ${agreeing}/${llmRuns.length}]`);
        } else {
          line += '  ' + pc.dim('[llm]');
        }
      }
    }
  }

  if (exceedsThreshold) {
    line += '  ' + pc.red('EXCEEDS THRESHOLD');
  }

  return line;
}


function formatReport(report: AnalysisReport, options: ReporterOptions): string {
  switch (options.format) {
    case 'json':
      return formatJson(report);
    case 'markdown':
      return formatMarkdown(report);
    case 'tree':
    default:
      return formatTree(report, options);
  }
}


function formatTree(report: AnalysisReport, options: ReporterOptions): string {
  const parts: string[] = [];

  for (const entry of report.entries) {
    if (entry.treeOutput) {
      parts.push(entry.treeOutput);
    } else {
      const line =
        pc.bold(entry.functionName) +
        '  ' +
        entry.complexity.notation +
        '  ' +
        pc.red('(analysis error)');
      parts.push(line);
    }
    parts.push('');
  }

  // Summary line
  for (const entry of report.entries) {
    const notation = entry.complexity.notation;
    const conf = entry.confidence < 1.0
      ? `, confidence ${(entry.confidence * 100).toFixed(0)}%`
      : '';
    const status = entry.exceedsThreshold
      ? pc.red(' — exceeds threshold')
      : entry.lowConfidence
      ? pc.yellow(' — low confidence')
      : '';
    parts.push(`${pc.bold(entry.functionName)}: ${notation}${conf}${status}`);
  }

  return parts.join('\n').trimEnd();
}


function formatJson(report: AnalysisReport): string {
  return JSON.stringify(report, null, 2);
}


function formatMarkdown(report: AnalysisReport): string {
  const header = '| Function | Complexity | Confidence | Status |';
  const separator = '|----------|-----------|------------|--------|';

  const rows = report.entries.map((entry) => {
    const status = entry.exceedsThreshold
      ? '⚠️ EXCEEDS THRESHOLD'
      : entry.lowConfidence
      ? '⚠️ LOW CONFIDENCE'
      : '✅ OK';
    return `| ${entry.functionName} | ${entry.complexity.notation} | ${entry.confidence.toFixed(2)} | ${status} |`;
  });

  return [header, separator, ...rows].join('\n');
}
