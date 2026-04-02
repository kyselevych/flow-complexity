import { BigOExpression, LLMRunResult } from '../../types/complexity.js';
import { parseComplexityString, bigOFromClass } from '../../complexity/complexity-math.js';

export interface LLMComplexityResponse {
  readonly complexity: string;  // "O(n)", "O(n^2)", etc.
  readonly variable: string;
  readonly reasoning: string;
}

export function parseLLMResponse(raw: string): LLMComplexityResponse {
  let jsonText = raw.trim();

  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`LLM response is not valid JSON: ${(err as Error).message}\nRaw: ${raw}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`LLM response JSON is not an object. Got: ${typeof parsed}`);
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['complexity'] !== 'string') {
    throw new Error(
      `LLM response missing or invalid 'complexity' field. Got: ${JSON.stringify(obj['complexity'])}`
    );
  }
  if (typeof obj['variable'] !== 'string') {
    throw new Error(
      `LLM response missing or invalid 'variable' field. Got: ${JSON.stringify(obj['variable'])}`
    );
  }
  if (typeof obj['reasoning'] !== 'string') {
    throw new Error(
      `LLM response missing or invalid 'reasoning' field. Got: ${JSON.stringify(obj['reasoning'])}`
    );
  }

  return {
    complexity: obj['complexity'] as string,
    variable: obj['variable'] as string,
    reasoning: obj['reasoning'] as string,
  };
}

export function toLLMRunResult(parsed: LLMComplexityResponse, raw: string): LLMRunResult {
  const cls = parseComplexityString(parsed.complexity);
  const expression: BigOExpression = bigOFromClass(cls, parsed.variable);

  return {
    complexity: expression,
    reasoning: parsed.reasoning,
    rawResponse: raw,
  };
}
