export interface PromptContext {
  readonly functionSource: string;
  readonly callerContext?: string;
  readonly inputVariable?: string;
}

export function buildComplexityPrompt(ctx: PromptContext): string {
  const callerContext = ctx.callerContext ?? 'top-level analysis target';
  const inputVariable = ctx.inputVariable ?? 'determine from the code';

  // Escape triple backticks in function source to avoid breaking the prompt fence
  const escapedSource = ctx.functionSource.replace(/```/g, '` ` `');

  return `You are an algorithm complexity analyst. Analyze the following TypeScript function
and determine its Big-O time complexity.

## Function:
\`\`\`typescript
${escapedSource}
\`\`\`

## Context:
- Called from: ${callerContext}
- Primary input variable (n): ${inputVariable}

IMPORTANT: Express complexity in terms of the primary input variable above. Loops over other variables that do NOT scale with the primary input should be treated as constant factors. For example, if the input is "items" but a loop iterates over a small fixed-size collection, that loop is O(1), not O(n).

## Response (strict JSON, no markdown):
{
  "complexity": "O(n)",
  "variable": "items.length",
  "reasoning": "Single linear pass over the items array."
}

Only use: O(1), O(log n), O(n), O(n log n), O(n^2), O(n^3), O(2^n), O(n!).`;
}
