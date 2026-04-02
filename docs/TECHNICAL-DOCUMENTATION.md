# flow-complexity — Technical Documentation

## Overview

**flow-complexity** is a CLI tool for static Big-O complexity analysis of TypeScript execution flows. It combines deterministic AST-based pattern matching with LLM-powered semantic evaluation to determine the asymptotic time complexity of annotated functions, including cross-module call chains.

**Key capability:** Analyzes entire execution flows (not isolated functions) by inlining function calls across module boundaries, building a unified flow tree from entry point to leaf operations.

## Architecture

```
Source → [1. Scanner] → [2. Call Graph Builder] → [3. Leaf Classifier]
     → [4. Complexity Evaluator] → [5. Aggregator] → [5.5 LLM Fallback]
     → [6. Reporter]
```

## CLI Usage

```bash
flow-complexity analyze <project-path> [options]
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--threshold <complexity>` | `O(n^2)` | Alert when complexity exceeds this |
| `--llm-runs <N>` | `3` | Number of LLM consensus runs |
| `--llm-provider <provider>` | `anthropic` | LLM provider |
| `--llm-model <model>` | `claude-sonnet-4-20250514` | LLM model |
| `--confidence-min <float>` | `0.5` | Minimum confidence threshold |
| `--output <format>` | `tree` | Output: `tree`, `json`, `markdown` |
| `--no-llm` | `false` | Deterministic-only mode |

**Exit codes:** 0 = OK, 1 = threshold exceeded, 2 = low confidence, 3 = error.

**Environment:** Requires `ANTHROPIC_API_KEY` environment variable for LLM mode.

## Annotation System

Functions must be annotated with JSDoc tags to be analyzed:

```typescript
/** @analyze-complexity @complexity-input items */
export function processItems(items: Item[]): Result {
  // ...
}
```

- `@analyze-complexity` — marks the function for analysis (required)
- `@complexity-input <variable>` — declares the primary input variable (optional, used for input-aware loop classification and LLM context)

## Pipeline Stages

### Stage 1: Scanner

**File:** `src/pipeline/scanner.ts`

Discovers all TypeScript functions annotated with `@analyze-complexity`. Supports function declarations, arrow functions, function expressions, and method declarations. Handles ts-morph JSDoc attachment quirk: for arrow/expression functions, checks both the function node and parent VariableStatement.

**Output:** `ScanResult[]` — function name, file path, location, AST node, declared input variable.

### Stage 2: Call Graph Builder

**File:** `src/pipeline/call-graph-builder.ts`

Constructs a `FlowNode` tree via DFS traversal of the function body. This is the core of the flow analysis.

**Node types:**

| AST Construct | FlowNode Kind | Complexity Semantics |
|---------------|---------------|---------------------|
| Block/statements | `sequential` | C = max(children) |
| if/else, switch, ternary | `branch` | C = max(branches) — worst case |
| for, while, for-of, do-while | `loop` | C = body × O(n) |
| Promise.all([...]) | `async-parallel` | C = max(children) |
| for await (...) | `for-await` | C = body × O(n) |
| Recursive call | `recursion` | Depends on shrink pattern |
| Everything else | `leaf` | Base unit |

**Cross-module function inlining:**

When a call expression is encountered, `resolveCallTarget()` uses ts-morph's type system to find the function definition — even across file boundaries via imports. If found and `depth < maxInlineDepth` (default 3), the callee's body is recursively inlined into the flow tree. This enables end-to-end flow analysis:

```
controller.ts: handleCreateOrder()
  → order-service.ts: createOrder()        [inlined at depth 1]
    → inventory-service.ts: validateStock() [inlined at depth 2]
    → pricing-service.ts: calculateTotal()  [inlined at depth 2]
      → database.ts: saveOrder()            [inlined at depth 3]
```

**Recursion detection:** If the call target is already in the call stack, the node is marked as `recursion` with a shrink pattern:
- `linear`: argument decreases by constant (n-1, arr.slice(1))
- `halving`: argument halves (n/2, Math.floor(n/2), slice(0, mid))
- `unknown`: pattern not recognized

**Loop metadata extraction:** For for-statements, extracts `loopBound` from the condition. Resolves aliases: if `len = arr.length` appears in the initializer and the condition is `i < len`, stores `arr.length` as the bound (not `len`).

**Labeled statement support:** Unwraps labeled statements (e.g., `LOOP: for(...)`) to their inner statement.

### Stage 3: Leaf Classifier

**File:** `src/pipeline/leaf-classifier.ts`

Classifies each leaf node to determine the evaluation strategy:

1. **Semantic (DB/API/network)** — matches patterns: `db.`, `.query`, `.fetch`, `http`, `.request`, `redis`, `mongo`, `postgres`, `sql`, `graphql` → always LLM
2. **Deterministic (builtin)** — known methods with fixed complexity:
   - O(1): `push`, `pop`, `Map.get`, `Set.has`, `Math.*`
   - O(n): `filter`, `map`, `reduce`, `slice`, `JSON.parse`
   - O(n log n): `sort`
3. **Semantic (external)** — `isExternal && not builtin` → LLM
4. **Deterministic (simple)** — no callee, not external → O(1)

### Stage 4: Complexity Evaluator

**File:** `src/pipeline/complexity-evaluator.ts`

Evaluates each classified leaf:

- **Deterministic path:** Pattern matching via `matchPattern()` — recognizes nested loops, halving loops, builtin method calls, sort calls. Confidence 1.0.
- **Semantic path:** N runs (default 3) with temperatures [0.3, 0.4, 0.5]. Structured prompt with JSON schema. Consensus via voting. Timeout 30 seconds per leaf. Results cached by callee name or source hash.
- **--no-llm mode:** Semantic leaves → Unknown, confidence 0.0.

### Stage 5: Aggregator

**File:** `src/pipeline/aggregator.ts`

Combines leaf results bottom-up through the flow tree using complexity algebra rules.

**Aggregation rules:**

| Kind | Complexity | Confidence |
|------|-----------|------------|
| sequential | max(children) | min(confidences) |
| branch | max(branches) | dominant.confidence |
| loop | body × O(n) or O(log n) | product(confidences) × penalties |
| for-await | body × O(n) | product(confidences) |
| async-parallel | max(children) | min(confidences) |
| recursion (linear) | body × O(n) | body.conf × 0.8 |
| recursion (halving) | body × O(log n) | body.conf × 0.8 |
| recursion (unknown) | Unknown | 0.0 |

**Complexity multiplication** uses a lookup table (60+ rules). Non-standard products (e.g., O(n log n) × O(n) = O(n² log n)) → Unknown.

**Confidence penalties:**
- If `bigOMultiply` produces Unknown → confidence = 0.0
- If loop bound does not contain `@complexity-input` variable name → confidence × 0.4
- If loop body contains collection mutation pattern (`.push(...collection.map(...))`) → confidence × 0.4

**Input-aware loop classification:** The aggregator receives the declared input variable from `@complexity-input`. For each loop, it checks whether the loop bound textually relates to the input variable. If not (e.g., iterating over `routers` when input is `routes`), confidence is penalized, which may trigger LLM fallback for a more accurate evaluation.

### Stage 5.5: LLM Whole-Function Fallback

**File:** `src/pipeline/whole-function-evaluator.ts`

After aggregation, if the root result's confidence < `confidenceMin` (default 0.5):

1. Extract the entire function source code
2. Send to LLM via the same micro-evaluator (3 runs, consensus)
3. LLM sees the complete function and determines complexity relative to the declared input variable
4. Result replaces the aggregated result
5. On failure/timeout, the aggregated result is kept

This handles cases where:
- Recursion shrink pattern is unrecognized (permutations, mergeSort, quickSort, nQueens)
- Loop bounds don't match the input variable (multi-variable functions)
- Complexity multiplication produces Unknown (non-standard combinations)
- Collection mutation suggests exponential growth (powerSet)

### Stage 6: Reporter

**File:** `src/pipeline/reporter.ts`

Formats results in three formats:

**Tree (default):** ASCII tree with colors showing the flow structure:
```
handleCreateOrder  O(n)  confidence=1.00
├── users.find()  O(1)  [deterministic]
├── [loop: items]
│   └── stock.find()  O(1)  [deterministic]
├── [loop: items]
│   └── [loop: priceRules]
│       └── node_22()  O(1)  [deterministic]
└── orders.push()  O(1)  [deterministic]
```

**JSON:** Machine-readable output with entries, exit code, summary.

**Markdown:** Table format for documentation.

## LLM Evaluation Details

### Prompt Template

**File:** `src/evaluators/llm/prompt-templates.ts`

```
You are an algorithm complexity analyst. Analyze the following TypeScript function
and determine its Big-O time complexity.

## Function:
[function source code]

## Context:
- Called from: [caller context]
- Primary input variable (n): [input variable]

IMPORTANT: Express complexity in terms of the primary input variable above.
Loops over other variables that do NOT scale with the primary input should
be treated as constant factors.

## Response (strict JSON):
{"complexity": "O(n)", "variable": "items.length", "reasoning": "..."}

Only use: O(1), O(log n), O(n), O(n log n), O(n^2), O(n^3), O(2^n), O(n!).
```

### Consensus Algorithm

**File:** `src/evaluators/llm/consensus.ts`

- All runs agree → confidence = 1.0
- Majority agrees (k/N > 0.5) → confidence = k/N, use majority result
- No majority → confidence = 1/N, use max complexity (conservative)

### Response Parsing

**File:** `src/evaluators/llm/response-parser.ts`

Strips markdown fences, parses JSON, validates schema, converts complexity string to BigOClass enum. Handles unicode notation (², ³).

## Complexity Mathematics

**File:** `src/complexity/complexity-math.ts`

**BigOClass enum:** O(1)=0, O(log n)=1, O(n)=2, O(n log n)=3, O(n²)=4, O(n³)=5, O(2^n)=6, O(n!)=7, Unknown=99.

**Multiplication table** (selected rules):
- O(1) × X = X
- O(log n) × O(n) = O(n log n)
- O(n) × O(n) = O(n²)
- O(n) × O(n²) = O(n³)
- O(log n) × O(log n) = Unknown (O(log² n) not in class set)
- O(n) × O(n log n) = Unknown (O(n² log n) not in class set)

**Parsing:** Normalizes strings like "O(n^2)", "n log n", "nlogn", handles unicode ²/³.

## Configuration

**File:** `src/config/defaults.ts`

```typescript
{
  threshold: BigOClass.ON2,           // O(n²)
  confidenceMin: 0.5,
  output: 'tree',
  noLlm: false,
  maxInlineDepth: 3,
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    runs: 3,
    temperatures: [0.3, 0.4, 0.5],
    maxTokens: 1024,
  }
}
```

## Type System

### FlowNode

```typescript
interface FlowNode {
  id: string;
  kind: 'sequential' | 'branch' | 'loop' | 'async-parallel' | 'for-await' | 'recursion' | 'leaf';
  astNode: Node;           // ts-morph AST reference
  location: SourceLocation;
  children: FlowNode[];
  metadata: FlowNodeMetadata;
  result?: ComplexityResult;
}

interface FlowNodeMetadata {
  functionName?: string;
  loopVariable?: string;
  loopBound?: string;
  recursionShrink?: 'linear' | 'halving' | 'unknown';
  isExternal?: boolean;
  calleeName?: string;
}
```

### ComplexityResult

```typescript
interface ComplexityResult {
  complexity: BigOExpression;        // { class, variable, notation }
  confidence: number;                // [0, 1]
  source: 'deterministic' | 'llm' | 'aggregated';
  reasoning: string;
  llmRuns?: LLMRunResult[];
}
```

## Caching

**File:** `src/cache/memo-cache.ts`

In-memory cache keyed by callee name or source hash. Shared across all functions in a pipeline run. Whole-function evaluator uses `whole:<functionName>` prefix.

## Benchmark

**30 functions** in two categories:

**Deterministic (15):** constant, linearSearch, nestedLoop, tripleNested, binarySearchIterative, twoPointers, bubbleSort, selectionSort, arraySum, findMax, matrixDiagonal, countOccurrences, reverseArray, isPalindrome, prefixSum.

**Semantic (15):** sortWithLibrary, bfsTraversal, dfsTraversal, dijkstra, memoizedFibonacci, knapsack01, longestCommonSubsequence, permutations, powerSet, mergeSort, quickSort, topologicalSort, levenshteinDistance, nQueens, maxSubarrayKadane.

**Results:**
- --no-llm mode: 80% overall (100% deterministic, 60% semantic)
- With LLM: 100% overall (100% deterministic, 100% semantic)
- Precision @ confidence >= 0.5: 96.7%

**Scripts:**
```bash
npm run benchmark          # Full benchmark with LLM
npm run benchmark:no-llm   # Deterministic only
npm run benchmark:report   # Generate LaTeX report
```

## Real-World Validation

Tested on two open-source projects:

**Hono web framework (router):** 4 functions — trie insert O(n), trie search O(n²), linear router match O(n), smart router match O(n). All correct.

**Medusa e-commerce backend:** 6 functions — deep flat map O(n²), order processing O(n²), inventory validation O(n), variant assignment O(n), promotion eligibility O(n), order changes O(n). All correct.

**Cross-module flow test:** Controller → Service → Inventory + Pricing → Database chain across 4 files. Correctly inlined and analyzed as O(n).

## Project Structure

```
flow-complexity/
├── bin/flow-complexity.ts              # CLI entry point
├── src/
│   ├── pipeline/
│   │   ├── pipeline.ts                 # Main orchestration (7 stages)
│   │   ├── scanner.ts                  # Stage 1: function discovery
│   │   ├── call-graph-builder.ts       # Stage 2: flow tree construction
│   │   ├── leaf-classifier.ts          # Stage 3: leaf classification
│   │   ├── complexity-evaluator.ts     # Stage 4: leaf evaluation
│   │   ├── aggregator.ts              # Stage 5: result aggregation
│   │   ├── whole-function-evaluator.ts # Stage 5.5: LLM fallback
│   │   └── reporter.ts                # Stage 6: output formatting
│   ├── evaluators/
│   │   ├── llm/
│   │   │   ├── llm-client.ts          # Abstract LLM interface
│   │   │   ├── anthropic-client.ts    # Anthropic SDK adapter
│   │   │   ├── micro-evaluator.ts     # Multi-run LLM evaluation
│   │   │   ├── prompt-templates.ts    # LLM prompt construction
│   │   │   ├── response-parser.ts     # JSON response parsing
│   │   │   └── consensus.ts           # Voting algorithm
│   │   └── deterministic/
│   │       ├── patterns.ts            # AST pattern matching
│   │       ├── loop-analyzer.ts       # Halving loop detection
│   │       └── recursion-detector.ts  # Recursion shrink analysis
│   ├── complexity/
│   │   └── complexity-math.ts         # BigO algebra & parsing
│   ├── types/
│   │   ├── complexity.ts              # BigOClass, ComplexityResult
│   │   ├── flow-graph.ts             # FlowNode, ControlFlowKind
│   │   ├── classification.ts         # ClassifiedLeaf
│   │   ├── config.ts                 # AnalysisConfig, LLMConfig
│   │   └── report.ts                 # AnalysisReport, ReportEntry
│   ├── config/defaults.ts            # Default configuration
│   ├── cache/memo-cache.ts           # In-memory result cache
│   └── util/
│       ├── ast-helpers.ts            # resolveCallTarget, getFunctionName
│       ├── source-extract.ts         # Clean source for LLM
│       └── logger.ts                 # Structured logging
├── benchmark/
│   ├── runner.ts                     # Benchmark harness
│   ├── ground-truth.json             # Expected results (30 functions)
│   ├── report-generator.ts           # LaTeX report
│   └── suite/                        # Test function suites
├── test/                             # 426 unit + integration tests
├── package.json
└── tsconfig.json
```

## Known Limitations

1. **TypeScript only** — uses ts-morph for AST parsing
2. **Single-variable model** — Big-O expressed relative to one declared input variable; multi-variable complexity (e.g., O(V+E) for graphs) requires separate annotation
3. **maxInlineDepth limit** — defaults to 3 levels of cross-module inlining; deeper call chains treated as external
4. **LLM model dependency** — semantic evaluation results depend on the specific LLM model used
5. **O-big ignores constants** — cannot distinguish between O(n) with constant 1 vs constant 1000
6. **No data-flow analysis for loop bounds** — input-awareness uses textual name matching, not data-flow tracing; intermediate variables like `len = arr.length` are resolved via initializer alias detection, but complex derivations may be missed
