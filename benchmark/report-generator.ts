import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { BenchmarkReport } from './runner.js';
import { BigOClass } from '../src/types/complexity.js';
import { notationFromClass } from '../src/complexity/complexity-math.js';

function latexEscape(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/_/g, '\\_')
    .replace(/\^/g, '\\^{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}');
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}\\%`;
}

function generateAccuracyTable(report: BenchmarkReport): string {
  const { accuracy, deterministicAccuracy, semanticAccuracy } = report.metrics;
  const total = report.results.length;
  const detTotal = report.results.filter((r) => r.category === 'deterministic').length;
  const semTotal = report.results.filter((r) => r.category === 'semantic').length;

  const lines: string[] = [
    '\\begin{table}[h]',
    '  \\centering',
    '  \\caption{Benchmark Accuracy Summary}',
    '  \\label{tab:accuracy}',
    '  \\begin{tabular}{lrr}',
    '    \\toprule',
    '    Category & Functions & Accuracy \\\\',
    '    \\midrule',
    `    Deterministic (AST) & ${detTotal} & ${pct(deterministicAccuracy)} \\\\`,
    `    Semantic (LLM-assisted) & ${semTotal} & ${pct(semanticAccuracy)} \\\\`,
    '    \\midrule',
    `    \\textbf{Overall} & ${total} & \\textbf{${pct(accuracy)}} \\\\`,
    '    \\bottomrule',
    '  \\end{tabular}',
    '\\end{table}',
  ];
  return lines.join('\n');
}

function generatePrecisionAtConfidenceTable(report: BenchmarkReport): string {
  const { precisionAtConfidence } = report.metrics;

  const rows: string[] = [];
  for (const [threshold, precision] of Object.entries(precisionAtConfidence)) {
    const t = parseFloat(threshold);
    const count = report.results.filter((r) => r.confidence >= t).length;
    rows.push(`    $\\geq ${threshold}$ & ${count} & ${pct(precision)} \\\\`);
  }

  const lines: string[] = [
    '\\begin{table}[h]',
    '  \\centering',
    '  \\caption{Precision at Confidence Threshold}',
    '  \\label{tab:precision-confidence}',
    '  \\begin{tabular}{lrr}',
    '    \\toprule',
    '    Confidence $\\geq$ & Functions & Precision \\\\',
    '    \\midrule',
    ...rows,
    '    \\bottomrule',
    '  \\end{tabular}',
    '\\end{table}',
  ];
  return lines.join('\n');
}

function generateConfusionMatrix(report: BenchmarkReport): string {
  const { confusionMatrix } = report.metrics;

  const labelSet = new Set<string>();
  for (const [expected, predictions] of Object.entries(confusionMatrix)) {
    labelSet.add(expected);
    for (const predicted of Object.keys(predictions)) {
      labelSet.add(predicted);
    }
  }

  const classOrder = Object.values(BigOClass)
    .filter((v): v is BigOClass => typeof v === 'number')
    .sort((a, b) => a - b)
    .map(notationFromClass);
  const labels = [...labelSet].sort(
    (a, b) => (classOrder.indexOf(a) ?? 99) - (classOrder.indexOf(b) ?? 99),
  );

  const header =
    '    \\textbf{Expected $\\backslash$ Predicted} & ' +
    labels.map((l) => `\\textbf{${latexEscape(l)}}`).join(' & ') +
    ' \\\\';

  const rows: string[] = labels.map((expected) => {
    const cols = labels
      .map((predicted) => {
        const val = confusionMatrix[expected]?.[predicted] ?? 0;
        return val === 0 ? '---' : String(val);
      })
      .join(' & ');
    return `    ${latexEscape(expected)} & ${cols} \\\\`;
  });

  const colSpec = 'l' + 'r'.repeat(labels.length);

  const lines: string[] = [
    '\\begin{table}[h]',
    '  \\centering',
    '  \\caption{Confusion Matrix (rows: expected, cols: predicted)}',
    '  \\label{tab:confusion}',
    `  \\begin{tabular}{${colSpec}}`,
    '    \\toprule',
    header,
    '    \\midrule',
    ...rows,
    '    \\bottomrule',
    '  \\end{tabular}',
    '\\end{table}',
  ];
  return lines.join('\n');
}

function generatePerFunctionTable(report: BenchmarkReport): string {
  const sorted = [...report.results].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.functionName.localeCompare(b.functionName);
  });

  const rows: string[] = [];
  let lastCategory = '';
  for (const r of sorted) {
    if (r.category !== lastCategory) {
      lastCategory = r.category;
      const label = r.category === 'deterministic' ? 'Deterministic (AST)' : 'Semantic (LLM)';
      rows.push(`    \\multicolumn{5}{l}{\\textit{${label}}} \\\\`);
    }
    const tick = r.correct ? '$\\checkmark$' : '$\\times$';
    rows.push(
      `    \\texttt{${latexEscape(r.functionName)}} & ` +
        `${latexEscape(r.expectedNotation)} & ` +
        `${latexEscape(r.actualNotation)} & ` +
        `${r.confidence.toFixed(2)} & ` +
        `${tick} \\\\`,
    );
  }

  const lines: string[] = [
    '\\begin{table}[h]',
    '  \\centering',
    '  \\caption{Per-Function Analysis Results}',
    '  \\label{tab:per-function}',
    '  \\begin{tabular}{lllrr}',
    '    \\toprule',
    '    Function & Expected & Actual & Confidence & Correct \\\\',
    '    \\midrule',
    ...rows,
    '    \\bottomrule',
    '  \\end{tabular}',
    '\\end{table}',
  ];
  return lines.join('\n');
}

export function generateLatexReport(report: BenchmarkReport): string {
  const tables = [
    generateAccuracyTable(report),
    generatePrecisionAtConfidenceTable(report),
    generateConfusionMatrix(report),
    generatePerFunctionTable(report),
  ];
  return tables.join('\n\n') + '\n';
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const reportPath = path.join(__dirname, 'benchmark-report.json');

  if (!fs.existsSync(reportPath)) {
    console.error(
      `[report-generator] benchmark-report.json not found.\n` +
        `Run "npm run benchmark" first to generate it.`,
    );
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as BenchmarkReport;
  const latex = generateLatexReport(report);

  const outPath = path.join(__dirname, 'benchmark-report.tex');
  fs.writeFileSync(outPath, latex);
  console.log(`[report-generator] LaTeX report written to ${outPath}`);

  console.log('\n--- LaTeX Output ---\n');
  console.log(latex);
}

main().catch((err) => {
  console.error('[report-generator] Fatal error:', err);
  process.exit(1);
});
