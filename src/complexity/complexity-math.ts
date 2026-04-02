import { BigOClass, BigOExpression } from '../types/complexity.js';

export function bigOOrder(cls: BigOClass): number {
  return cls as number;
}

export function bigOCompare(a: BigOClass, b: BigOClass): -1 | 0 | 1 {
  const oa = bigOOrder(a);
  const ob = bigOOrder(b);
  if (oa < ob) return -1;
  if (oa > ob) return 1;
  return 0;
}

export function bigOMax(a: BigOExpression, b: BigOExpression): BigOExpression {
  return bigOCompare(a.class, b.class) >= 0 ? a : b;
}

export function notationFromClass(cls: BigOClass): string {
  switch (cls) {
    case BigOClass.O1:      return 'O(1)';
    case BigOClass.OLogN:   return 'O(log n)';
    case BigOClass.ON:      return 'O(n)';
    case BigOClass.ONLogN:  return 'O(n log n)';
    case BigOClass.ON2:     return 'O(n²)';
    case BigOClass.ON3:     return 'O(n³)';
    case BigOClass.O2N:     return 'O(2^n)';
    case BigOClass.ONFact:  return 'O(n!)';
    case BigOClass.Unknown: return 'O(?)';
    default:                return 'O(?)';
  }
}

export function bigOFromClass(cls: BigOClass, variable = 'n'): BigOExpression {
  return {
    class: cls,
    variable,
    notation: notationFromClass(cls),
  };
}

// Multiply lookup table: key is `${a}:${b}`, value is resulting BigOClass.
// Encodes the common algebraic simplification rules.
type MultiplyKey = `${number}:${number}`;

function mk(a: BigOClass, b: BigOClass): MultiplyKey {
  return `${a as number}:${b as number}`;
}

const MULTIPLY_TABLE: ReadonlyMap<MultiplyKey, BigOClass> = new Map<MultiplyKey, BigOClass>([
  // O(1) * X = X
  [mk(BigOClass.O1, BigOClass.O1),      BigOClass.O1],
  [mk(BigOClass.O1, BigOClass.OLogN),   BigOClass.OLogN],
  [mk(BigOClass.O1, BigOClass.ON),      BigOClass.ON],
  [mk(BigOClass.O1, BigOClass.ONLogN),  BigOClass.ONLogN],
  [mk(BigOClass.O1, BigOClass.ON2),     BigOClass.ON2],
  [mk(BigOClass.O1, BigOClass.ON3),     BigOClass.ON3],
  [mk(BigOClass.O1, BigOClass.O2N),     BigOClass.O2N],
  [mk(BigOClass.O1, BigOClass.ONFact),  BigOClass.ONFact],
  [mk(BigOClass.O1, BigOClass.Unknown), BigOClass.Unknown],

  // X * O(1) = X  (symmetric cases)
  [mk(BigOClass.OLogN,  BigOClass.O1),  BigOClass.OLogN],
  [mk(BigOClass.ON,     BigOClass.O1),  BigOClass.ON],
  [mk(BigOClass.ONLogN, BigOClass.O1),  BigOClass.ONLogN],
  [mk(BigOClass.ON2,    BigOClass.O1),  BigOClass.ON2],
  [mk(BigOClass.ON3,    BigOClass.O1),  BigOClass.ON3],
  [mk(BigOClass.O2N,    BigOClass.O1),  BigOClass.O2N],
  [mk(BigOClass.ONFact, BigOClass.O1),  BigOClass.ONFact],
  [mk(BigOClass.Unknown,BigOClass.O1),  BigOClass.Unknown],

  // O(log n) * O(log n) = O(log^2 n) — not a standard class, use Unknown
  [mk(BigOClass.OLogN, BigOClass.OLogN), BigOClass.Unknown],

  // O(log n) * O(n) = O(n log n)
  [mk(BigOClass.OLogN, BigOClass.ON),    BigOClass.ONLogN],
  [mk(BigOClass.ON,    BigOClass.OLogN), BigOClass.ONLogN],

  // O(log n) * O(n log n) = O(n log^2 n) — not standard, use Unknown
  [mk(BigOClass.OLogN, BigOClass.ONLogN), BigOClass.Unknown],
  [mk(BigOClass.ONLogN, BigOClass.OLogN), BigOClass.Unknown],

  // O(n) * O(n) = O(n^2)
  [mk(BigOClass.ON, BigOClass.ON), BigOClass.ON2],

  // O(n) * O(n log n) = O(n^2 log n) — not standard, use Unknown
  [mk(BigOClass.ON, BigOClass.ONLogN), BigOClass.Unknown],
  [mk(BigOClass.ONLogN, BigOClass.ON), BigOClass.Unknown],

  // O(n) * O(n^2) = O(n^3)
  [mk(BigOClass.ON,  BigOClass.ON2), BigOClass.ON3],
  [mk(BigOClass.ON2, BigOClass.ON),  BigOClass.ON3],

  // O(n log n) * O(n log n) = O(n^2 log^2 n) — not standard, use Unknown
  [mk(BigOClass.ONLogN, BigOClass.ONLogN), BigOClass.Unknown],

  // O(n^2) * O(n^2) = O(n^4) — not standard, use Unknown
  [mk(BigOClass.ON2, BigOClass.ON2), BigOClass.Unknown],

  // Anything with exponential/factorial stays at the higher class
  [mk(BigOClass.O2N,    BigOClass.O2N),    BigOClass.O2N],
  [mk(BigOClass.ONFact, BigOClass.ONFact), BigOClass.ONFact],
]);

export function bigOMultiply(base: BigOExpression, factor: BigOExpression): BigOExpression {
  const key = mk(base.class, factor.class);
  const result = MULTIPLY_TABLE.get(key);

  if (result !== undefined) {
    const variable =
      base.class === BigOClass.O1 && factor.class !== BigOClass.O1
        ? factor.variable
        : base.variable;
    return bigOFromClass(result, variable);
  }

  return bigOFromClass(BigOClass.Unknown, base.variable);
}

export function parseComplexityString(s: string): BigOClass {
  const normalized = s.trim().toLowerCase();

  const outerMatch = normalized.match(/^o\((.+)\)$/);
  const inner = outerMatch ? outerMatch[1].trim() : normalized;

  const cleaned = inner
    .replace(/\s+/g, ' ')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*/g, ' ')
    .trim();

  switch (cleaned) {
    case '1':           return BigOClass.O1;
    case 'log n':
    case 'log(n)':
    case 'ln n':
    case 'ln(n)':       return BigOClass.OLogN;
    case 'n':           return BigOClass.ON;
    case 'n log n':
    case 'n*log n':
    case 'n log(n)':
    case 'nlogn':       return BigOClass.ONLogN;
    case 'n^2':
    case 'n2':          return BigOClass.ON2;
    case 'n^3':
    case 'n3':          return BigOClass.ON3;
    case '2^n':
    case '2n':          return BigOClass.O2N;
    case 'n!':          return BigOClass.ONFact;
    default:            return BigOClass.Unknown;
  }
}
