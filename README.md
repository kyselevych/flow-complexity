# flow-complexity

Static Big-O complexity analyzer for TypeScript projects. Builds a control-flow tree from annotated functions, evaluates each node's time complexity using pattern matching and LLM consensus, then aggregates the result bottom-up.

## Installation

```bash
npm install
npm run build
```

Requires Node.js 18+ and an `ANTHROPIC_API_KEY` environment variable for LLM-assisted evaluation.

## Quick start

1. Annotate a function with `@analyze-complexity` in a JSDoc comment:

```ts
/**
 * @analyze-complexity
 * @complexity-input data
 */
function processItems(data: Item[]) {
  // ...
}
```

2. Run the analyzer:

```bash
flow-complexity analyze ./path/to/project
```

## Usage

```
flow-complexity analyze [options] <project-path>
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--threshold <complexity>` | Alert threshold (e.g. `"O(n^2)"`, `"O(n)"`) | `O(n^2)` |
| `--output <format>` | Output format: `tree`, `json`, `markdown` | `tree` |
| `--confidence-min <float>` | Minimum confidence to trust (0–1) | `0.5` |
| `--llm-runs <N>` | Number of LLM consensus runs | `3` |
| `--llm-model <model>` | LLM model identifier | `claude-sonnet-4-20250514` |
| `--no-llm` | Deterministic-only mode (skip LLM) | — |
| `--verbose` | Show logs and evaluation method labels | — |

### Examples

Analyze with default settings:

```bash
flow-complexity analyze ./my-project
```

Strict threshold, JSON output:

```bash
flow-complexity analyze ./my-project --threshold "O(n)" --output json
```

Deterministic-only (no API calls):

```bash
flow-complexity analyze ./my-project --no-llm
```

## Output formats

### Tree (default)

```
createReservationItems  O(n)
├── [sequential]  O(n)
│   ├── inventoryLevelService.list()  O(n)
│   ├── inventoryLevels.reduce()  O(n)
│   ├── data.filter()  O(n)
│   └── [loop: data]  O(n)
│       └── [sequential]  O(1)
│           ├── inventoryLevelItemLocationMap.get()  O(1)
│           └── locations?.get()  O(1)
├── reservationItemService.create()  O(1)
├── input.reduce()  O(n)
└── inventoryLevelService.update()  O(n)

createReservationItems: O(n)
```

Confidence is shown only when below 1.0. Use `--verbose` to see evaluation method labels (`[deterministic]` / `[llm: 2/3]`).

### JSON

Full structured report with complexity, confidence, source, and reasoning for every node.

### Markdown

Summary table for CI integration or documentation.

## How it works

1. **Scanner** — finds functions annotated with `@analyze-complexity`
2. **Call Graph Builder** — traverses the AST into a control-flow tree (loops, branches, calls)
3. **Leaf Classifier** — categorizes leaf nodes as *deterministic* (known builtins) or *semantic* (requires LLM)
4. **Complexity Evaluator** — pattern-matches deterministic leaves; runs LLM consensus for semantic leaves
5. **Aggregator** — composes complexity bottom-up: sequential → max, loop → multiply, branch → worst-case
6. **Reporter** — formats the result tree with color-coded complexity and confidence

## Annotations

| Tag | Purpose | Example |
|-----|---------|---------|
| `@analyze-complexity` | Mark a function for analysis | `@analyze-complexity` |
| `@complexity-input` | Declare the input variable for Big-O | `@complexity-input items` |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All functions within threshold |
| `1` | Threshold exceeded |
| `2` | Low confidence (below `--confidence-min`) |
| `3` | Analysis error |

## Development

```bash
npm test              # run unit and integration tests
npm run benchmark     # run benchmark suite (requires ANTHROPIC_API_KEY)
npm run benchmark:no-llm  # benchmark without LLM
```

## Project structure

```
src/
├── pipeline/        # orchestration: scanner → classifier → evaluator → aggregator → reporter
├── evaluators/      # deterministic pattern matching + LLM micro-evaluator
├── complexity/      # Big-O algebra (multiply, compare, max)
├── types/           # TypeScript type definitions
├── config/          # default configuration
├── cache/           # memoization cache for LLM results
└── util/            # logger, AST helpers, source extraction
```
