import { describe, it, expect } from 'vitest';
import {
  bigOOrder,
  bigOCompare,
  bigOMax,
  bigOMultiply,
  bigOFromClass,
  notationFromClass,
  parseComplexityString,
} from '../../src/complexity/complexity-math.js';
import { BigOClass, BigOExpression } from '../../src/types/complexity.js';

function expr(cls: BigOClass, variable = 'n'): BigOExpression {
  return bigOFromClass(cls, variable);
}

describe('bigOOrder', () => {
  it('returns 0 for O(1)', () => {
    expect(bigOOrder(BigOClass.O1)).toBe(0);
  });
  it('returns 1 for O(log n)', () => {
    expect(bigOOrder(BigOClass.OLogN)).toBe(1);
  });
  it('returns 2 for O(n)', () => {
    expect(bigOOrder(BigOClass.ON)).toBe(2);
  });
  it('returns 3 for O(n log n)', () => {
    expect(bigOOrder(BigOClass.ONLogN)).toBe(3);
  });
  it('returns 4 for O(n²)', () => {
    expect(bigOOrder(BigOClass.ON2)).toBe(4);
  });
  it('returns 5 for O(n³)', () => {
    expect(bigOOrder(BigOClass.ON3)).toBe(5);
  });
  it('returns 6 for O(2^n)', () => {
    expect(bigOOrder(BigOClass.O2N)).toBe(6);
  });
  it('returns 7 for O(n!)', () => {
    expect(bigOOrder(BigOClass.ONFact)).toBe(7);
  });
  it('returns 99 for Unknown', () => {
    expect(bigOOrder(BigOClass.Unknown)).toBe(99);
  });
});

describe('bigOCompare', () => {
  it('returns -1 when a < b', () => {
    expect(bigOCompare(BigOClass.O1, BigOClass.ON)).toBe(-1);
    expect(bigOCompare(BigOClass.ON, BigOClass.ON2)).toBe(-1);
    expect(bigOCompare(BigOClass.OLogN, BigOClass.ON)).toBe(-1);
  });
  it('returns 0 when a === b', () => {
    expect(bigOCompare(BigOClass.ON, BigOClass.ON)).toBe(0);
    expect(bigOCompare(BigOClass.O1, BigOClass.O1)).toBe(0);
    expect(bigOCompare(BigOClass.Unknown, BigOClass.Unknown)).toBe(0);
  });
  it('returns 1 when a > b', () => {
    expect(bigOCompare(BigOClass.ON2, BigOClass.ON)).toBe(1);
    expect(bigOCompare(BigOClass.ONFact, BigOClass.O2N)).toBe(1);
  });
  it('treats Unknown (99) as greater than all concrete classes', () => {
    expect(bigOCompare(BigOClass.Unknown, BigOClass.ONFact)).toBe(1);
    expect(bigOCompare(BigOClass.ONFact, BigOClass.Unknown)).toBe(-1);
  });
  it('returns only -1 | 0 | 1, never other numbers', () => {
    const result = bigOCompare(BigOClass.O1, BigOClass.ON2);
    expect([-1, 0, 1]).toContain(result);
  });
});

describe('bigOMax', () => {
  it('returns b when b has higher complexity', () => {
    const a = expr(BigOClass.ON);
    const b = expr(BigOClass.ON2);
    expect(bigOMax(a, b)).toBe(b);
  });
  it('returns a when a has higher complexity', () => {
    const a = expr(BigOClass.ON2);
    const b = expr(BigOClass.ON);
    expect(bigOMax(a, b)).toBe(a);
  });
  it('returns a when both have equal complexity', () => {
    const a = expr(BigOClass.ON, 'items');
    const b = expr(BigOClass.ON, 'n');
    expect(bigOMax(a, b)).toBe(a);
  });
  it('Unknown is treated as highest class', () => {
    const a = expr(BigOClass.ONFact);
    const b = expr(BigOClass.Unknown);
    expect(bigOMax(a, b)).toBe(b);
  });
  it('O(1) vs O(n) returns O(n)', () => {
    const a = expr(BigOClass.O1);
    const b = expr(BigOClass.ON);
    expect(bigOMax(a, b).class).toBe(BigOClass.ON);
  });
  it('returns a when a and b are identical objects', () => {
    const a = expr(BigOClass.ON);
    expect(bigOMax(a, a)).toBe(a);
  });
});

describe('notationFromClass', () => {
  const cases: [BigOClass, string][] = [
    [BigOClass.O1,      'O(1)'],
    [BigOClass.OLogN,   'O(log n)'],
    [BigOClass.ON,      'O(n)'],
    [BigOClass.ONLogN,  'O(n log n)'],
    [BigOClass.ON2,     'O(n²)'],
    [BigOClass.ON3,     'O(n³)'],
    [BigOClass.O2N,     'O(2^n)'],
    [BigOClass.ONFact,  'O(n!)'],
    [BigOClass.Unknown, 'O(?)'],
  ];

  for (const [cls, expected] of cases) {
    it(`${BigOClass[cls]} → "${expected}"`, () => {
      expect(notationFromClass(cls)).toBe(expected);
    });
  }
});

describe('bigOFromClass', () => {
  it('creates expression with correct class and notation', () => {
    const e = bigOFromClass(BigOClass.ON2);
    expect(e.class).toBe(BigOClass.ON2);
    expect(e.notation).toBe('O(n²)');
    expect(e.variable).toBe('n');
  });
  it('uses provided variable name', () => {
    const e = bigOFromClass(BigOClass.ON, 'items');
    expect(e.variable).toBe('items');
  });
  it('defaults variable to "n"', () => {
    const e = bigOFromClass(BigOClass.O1);
    expect(e.variable).toBe('n');
  });
  it('Unknown class produces O(?)', () => {
    const e = bigOFromClass(BigOClass.Unknown);
    expect(e.notation).toBe('O(?)');
  });
  it('result is a plain object (readonly properties)', () => {
    const e = bigOFromClass(BigOClass.ON);
    expect(typeof e).toBe('object');
    expect(e).toHaveProperty('class');
    expect(e).toHaveProperty('variable');
    expect(e).toHaveProperty('notation');
  });
});

describe('bigOMultiply', () => {
  describe('O(1) identity', () => {
    it('O(1) * O(1) = O(1)', () => {
      expect(bigOMultiply(expr(BigOClass.O1), expr(BigOClass.O1)).class).toBe(BigOClass.O1);
    });
    it('O(1) * O(n) = O(n)', () => {
      expect(bigOMultiply(expr(BigOClass.O1), expr(BigOClass.ON)).class).toBe(BigOClass.ON);
    });
    it('O(n) * O(1) = O(n)', () => {
      expect(bigOMultiply(expr(BigOClass.ON), expr(BigOClass.O1)).class).toBe(BigOClass.ON);
    });
    it('O(1) * O(n^2) = O(n^2)', () => {
      expect(bigOMultiply(expr(BigOClass.O1), expr(BigOClass.ON2)).class).toBe(BigOClass.ON2);
    });
    it('O(1) * O(n!) = O(n!)', () => {
      expect(bigOMultiply(expr(BigOClass.O1), expr(BigOClass.ONFact)).class).toBe(BigOClass.ONFact);
    });
    it('O(1) * O(?) = O(?)', () => {
      expect(bigOMultiply(expr(BigOClass.O1), expr(BigOClass.Unknown)).class).toBe(BigOClass.Unknown);
    });
  });

  describe('O(n) combinations', () => {
    it('O(n) * O(n) = O(n^2)', () => {
      expect(bigOMultiply(expr(BigOClass.ON), expr(BigOClass.ON)).class).toBe(BigOClass.ON2);
    });
    it('O(n) * O(log n) = O(n log n)', () => {
      expect(bigOMultiply(expr(BigOClass.ON), expr(BigOClass.OLogN)).class).toBe(BigOClass.ONLogN);
    });
    it('O(log n) * O(n) = O(n log n)', () => {
      expect(bigOMultiply(expr(BigOClass.OLogN), expr(BigOClass.ON)).class).toBe(BigOClass.ONLogN);
    });
    it('O(n) * O(n^2) = O(n^3)', () => {
      expect(bigOMultiply(expr(BigOClass.ON), expr(BigOClass.ON2)).class).toBe(BigOClass.ON3);
    });
    it('O(n^2) * O(n) = O(n^3)', () => {
      expect(bigOMultiply(expr(BigOClass.ON2), expr(BigOClass.ON)).class).toBe(BigOClass.ON3);
    });
  });

  describe('log n combinations', () => {
    it('O(log n) * O(log n) = O(?)', () => {
      expect(bigOMultiply(expr(BigOClass.OLogN), expr(BigOClass.OLogN)).class).toBe(BigOClass.Unknown);
    });
    it('O(log n) * O(n log n) = O(?)', () => {
      expect(bigOMultiply(expr(BigOClass.OLogN), expr(BigOClass.ONLogN)).class).toBe(BigOClass.Unknown);
    });
  });

  describe('Unknown propagation', () => {
    it('O(?) * O(n) = O(?)', () => {
      expect(bigOMultiply(expr(BigOClass.Unknown), expr(BigOClass.ON)).class).toBe(BigOClass.Unknown);
    });
    it('O(n) * O(?) = O(?)', () => {
      expect(bigOMultiply(expr(BigOClass.ON), expr(BigOClass.Unknown)).class).toBe(BigOClass.Unknown);
    });
    it('O(1) * O(?) = O(?)', () => {
      expect(bigOMultiply(expr(BigOClass.O1), expr(BigOClass.Unknown)).class).toBe(BigOClass.Unknown);
    });
  });

  describe('exponential/factorial self-multiplication', () => {
    it('O(2^n) * O(2^n) = O(2^n)', () => {
      expect(bigOMultiply(expr(BigOClass.O2N), expr(BigOClass.O2N)).class).toBe(BigOClass.O2N);
    });
    it('O(n!) * O(n!) = O(n!)', () => {
      expect(bigOMultiply(expr(BigOClass.ONFact), expr(BigOClass.ONFact)).class).toBe(BigOClass.ONFact);
    });
  });

  describe('variable inheritance', () => {
    it('O(1) * O(n) inherits factor variable', () => {
      const base   = bigOFromClass(BigOClass.O1, 'n');
      const factor = bigOFromClass(BigOClass.ON, 'items');
      expect(bigOMultiply(base, factor).variable).toBe('items');
    });
    it('O(n) * O(1) keeps base variable', () => {
      const base   = bigOFromClass(BigOClass.ON, 'items');
      const factor = bigOFromClass(BigOClass.O1, 'n');
      expect(bigOMultiply(base, factor).variable).toBe('items');
    });
    it('O(n) * O(n) keeps base variable', () => {
      const base   = bigOFromClass(BigOClass.ON, 'rows');
      const factor = bigOFromClass(BigOClass.ON, 'cols');
      expect(bigOMultiply(base, factor).variable).toBe('rows');
    });
  });

  describe('produces valid BigOExpression', () => {
    it('result has class, variable, notation', () => {
      const result = bigOMultiply(expr(BigOClass.ON), expr(BigOClass.ON));
      expect(result).toHaveProperty('class');
      expect(result).toHaveProperty('variable');
      expect(result).toHaveProperty('notation');
    });
    it('notation matches class', () => {
      const result = bigOMultiply(expr(BigOClass.ON), expr(BigOClass.ON));
      expect(result.class).toBe(BigOClass.ON2);
      expect(result.notation).toBe('O(n²)');
    });
  });
});

describe('parseComplexityString', () => {
  describe('exact standard strings', () => {
    it('parses "O(1)"', () => {
      expect(parseComplexityString('O(1)')).toBe(BigOClass.O1);
    });
    it('parses "O(log n)"', () => {
      expect(parseComplexityString('O(log n)')).toBe(BigOClass.OLogN);
    });
    it('parses "O(n)"', () => {
      expect(parseComplexityString('O(n)')).toBe(BigOClass.ON);
    });
    it('parses "O(n log n)"', () => {
      expect(parseComplexityString('O(n log n)')).toBe(BigOClass.ONLogN);
    });
    it('parses "O(n^2)"', () => {
      expect(parseComplexityString('O(n^2)')).toBe(BigOClass.ON2);
    });
    it('parses "O(n^3)"', () => {
      expect(parseComplexityString('O(n^3)')).toBe(BigOClass.ON3);
    });
    it('parses "O(2^n)"', () => {
      expect(parseComplexityString('O(2^n)')).toBe(BigOClass.O2N);
    });
    it('parses "O(n!)"', () => {
      expect(parseComplexityString('O(n!)')).toBe(BigOClass.ONFact);
    });
  });

  describe('Unicode notation', () => {
    it('parses "O(n²)"', () => {
      expect(parseComplexityString('O(n²)')).toBe(BigOClass.ON2);
    });
    it('parses "O(n³)"', () => {
      expect(parseComplexityString('O(n³)')).toBe(BigOClass.ON3);
    });
  });

  describe('case-insensitivity', () => {
    it('parses "o(n)" lowercase', () => {
      expect(parseComplexityString('o(n)')).toBe(BigOClass.ON);
    });
    it('parses "O(N)" uppercase n', () => {
      expect(parseComplexityString('O(N)')).toBe(BigOClass.ON);
    });
    it('parses "O(Log N)"', () => {
      expect(parseComplexityString('O(Log N)')).toBe(BigOClass.OLogN);
    });
    it('parses "O(N^2)"', () => {
      expect(parseComplexityString('O(N^2)')).toBe(BigOClass.ON2);
    });
  });

  describe('whitespace tolerance', () => {
    it('parses with leading/trailing spaces', () => {
      expect(parseComplexityString('  O(n)  ')).toBe(BigOClass.ON);
    });
    it('parses "O( n )" with spaces inside', () => {
      expect(parseComplexityString('O( n )')).toBe(BigOClass.ON);
    });
  });

  describe('alternate representations', () => {
    it('parses "O(log(n))"', () => {
      expect(parseComplexityString('O(log(n))')).toBe(BigOClass.OLogN);
    });
    it('parses "O(nlogn)" no spaces', () => {
      expect(parseComplexityString('O(nlogn)')).toBe(BigOClass.ONLogN);
    });
    it('parses "O(n log(n))"', () => {
      expect(parseComplexityString('O(n log(n))')).toBe(BigOClass.ONLogN);
    });
  });

  describe('unknown / invalid strings', () => {
    it('returns Unknown for empty string', () => {
      expect(parseComplexityString('')).toBe(BigOClass.Unknown);
    });
    it('returns Unknown for garbage', () => {
      expect(parseComplexityString('O(n^4)')).toBe(BigOClass.Unknown);
    });
    it('returns Unknown for "O(?)"', () => {
      expect(parseComplexityString('O(?)')).toBe(BigOClass.Unknown);
    });
    it('returns Unknown for "O(n^2 log n)"', () => {
      expect(parseComplexityString('O(n^2 log n)')).toBe(BigOClass.Unknown);
    });
    it('returns Unknown for bare number "5"', () => {
      expect(parseComplexityString('5')).toBe(BigOClass.Unknown);
    });
  });
});
