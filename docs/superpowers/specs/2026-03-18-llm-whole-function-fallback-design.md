# LLM Whole-Function Fallback

## Problem

The deterministic analysis pipeline (stages 1-5) produces `Unknown` with `confidence: 0.0` for functions with unrecognized recursion patterns. Five benchmark functions fail because of this: `permutations`, `mergeSort`, `quickSort`, `nQueens`, `topologicalSort`. The LLM is never consulted — it currently operates only on individual leaf nodes (external/DB/API calls), not on whole functions.

A sixth failure (`powerSet`) is a false positive: the deterministic analyzer reports `O(n)` with `confidence: 1.0`, but the actual complexity is `O(2^n)`. This requires data-flow analysis beyond the current AST pattern matching and is documented as a known limitation.

## Solution

Add a single fallback step in the pipeline: after aggregation, if the aggregated result's confidence is below `confidenceMin`, send the entire function source to the LLM for independent evaluation via the existing micro-evaluator and consensus mechanism.

## Trigger

```
confidence < confidenceMin (default 0.5)
```

This fires for `recursion(unknown)` (confidence 0.0) and any future case where the deterministic path admits uncertainty. It does NOT fire in `--no-llm` mode.

## Architecture

```
Pipeline.run()
  ...
  rootResult = aggregator.aggregate(flowTree)

  if (llmClient && !noLlm && rootResult.confidence < confidenceMin):
      result = wholeFunctionEvaluator.evaluate(functionSource, name, inputVar)
  else:
      result = rootResult

  flowTree.result = result
  ...
```

### New module: `src/pipeline/whole-function-evaluator.ts`

Responsibilities:
- Accept full function source, name, and input variable
- Delegate to `MicroEvaluator` (same consensus: 3 runs, temperatures `[0.3, 0.4, 0.5]`)
- Return `ComplexityResult` with `source: 'llm'`

Interface:
```typescript
interface WholeFunctionEvaluator {
  evaluate(
    functionSource: string,
    functionName: string,
    inputVariable?: string,
  ): Promise<ComplexityResult>;
}

function createWholeFunctionEvaluator(options: {
  llmClient: LLMClient;
  llmConfig: LLMConfig;
  cache: MemoCache;
}): WholeFunctionEvaluator;
```

### Modified: `src/pipeline/pipeline.ts`

Add ~10 lines after `aggregator.aggregate()` to check confidence and invoke the fallback.

## Reused components

| Component | Role | Changes |
|-----------|------|---------|
| `MicroEvaluator` | Multi-run LLM with temperature schedule | None |
| `computeConsensus()` | Voting across runs | None |
| `buildPrompt()` | Structured prompt with JSON schema | None |
| `parseLLMResponse()` | JSON response parsing | None |
| `MemoCache` | Deduplication by function name | None |
| `extractFunctionSource()` | Clean source extraction | None |
| Aggregator | Deterministic bottom-up aggregation | None |
| Leaf Classifier | Leaf-level classification | None |
| Reporter | Output formatting | None |

## Timeout

The existing 30-second timeout in `complexity-evaluator.ts` applies per-leaf. The whole-function evaluator applies the same timeout pattern: `Promise.race()` with 30 seconds. On timeout, the aggregated (Unknown) result is kept.

## Confidence semantics

- LLM unanimous consensus: `confidence: 1.0`, `source: 'llm'`
- LLM majority: `confidence: majority/N`, `source: 'llm'`
- LLM no majority: `confidence: 1/N`, `source: 'llm'`, complexity = max (conservative)
- LLM timeout or failure: keep aggregated result (Unknown, 0.0)

## Files changed

| File | Change | Lines |
|------|--------|-------|
| `src/pipeline/whole-function-evaluator.ts` | New | ~40 |
| `src/pipeline/pipeline.ts` | Add fallback logic | ~10 |

## Known limitation

`powerSet` produces a false positive (`O(n)`, confidence 1.0) because the deterministic analyzer cannot track exponential data growth within loops. This requires data-flow analysis beyond AST pattern matching and is outside the scope of this change.

## Expected benchmark impact

| Function | Before | After (expected) |
|----------|--------|-------------------|
| permutations | O(?) conf 0.0 | O(n!) via LLM |
| mergeSort | O(?) conf 0.0 | O(n log n) via LLM |
| quickSort | O(?) conf 0.0 | O(n^2) via LLM |
| nQueens | O(?) conf 0.0 | O(n!) via LLM |
| topologicalSort | O(?) conf 0.0 | O(n) via LLM |
| powerSet | O(n) conf 1.0 | O(n) conf 1.0 (unchanged, documented limitation) |

Overall accuracy: 80% (24/30) -> expected 97% (29/30).
Semantic accuracy: 60% (9/15) -> expected 93% (14/15).
