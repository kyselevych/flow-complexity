import { FlowNode } from '../types/flow-graph.js';
import { ClassifiedLeaf, ClassificationResult } from '../types/classification.js';


const BUILTIN_METHOD_COMPLEXITY: Record<string, string> = {
  sort: 'O(n log n)',
  indexOf: 'O(n)',
  find: 'O(n)',
  filter: 'O(n)',
  map: 'O(n)',
  reduce: 'O(n)',
  forEach: 'O(n)',
  includes: 'O(n)',
  push: 'O(1)',
  pop: 'O(1)',
  // Map/Set methods
  get: 'O(1)',
  set: 'O(1)',
  has: 'O(1)',
  add: 'O(1)',
  delete: 'O(1)',
  // Object static methods
  keys: 'O(n)',
  values: 'O(n)',
  entries: 'O(n)',
  // Math methods (all O(1))
  floor: 'O(1)',
  ceil: 'O(1)',
  abs: 'O(1)',
  max: 'O(1)',
  min: 'O(1)',
  round: 'O(1)',
  sqrt: 'O(1)',
  pow: 'O(1)',
  log: 'O(1)',
  random: 'O(1)',
  trunc: 'O(1)',
  sign: 'O(1)',
  // Array mutators / accessors
  shift: 'O(n)',
  unshift: 'O(n)',
  splice: 'O(n)',
  slice: 'O(n)',
  concat: 'O(n)',
  reverse: 'O(n)',
  flat: 'O(n)',
  fill: 'O(n)',
  join: 'O(n)',
  every: 'O(n)',
  some: 'O(n)',
  findIndex: 'O(n)',
};

const STATIC_METHOD_COMPLEXITY: Record<string, string> = {
  'Object.keys': 'O(n)',
  'Object.values': 'O(n)',
  'Object.entries': 'O(n)',
  'JSON.parse': 'O(n)',
  'JSON.stringify': 'O(n)',
  'Math.floor': 'O(1)',
  'Math.ceil': 'O(1)',
  'Math.abs': 'O(1)',
  'Math.max': 'O(1)',
  'Math.min': 'O(1)',
  'Math.round': 'O(1)',
  'Math.sqrt': 'O(1)',
  'Math.pow': 'O(1)',
  'Math.log': 'O(1)',
  'Math.random': 'O(1)',
  'Math.trunc': 'O(1)',
  'Math.sign': 'O(1)',
  'Array.from': 'O(n)',
  'Array.isArray': 'O(1)',
};


const SEMANTIC_CALLEE_PATTERN = /db\.|\.query|\.fetch|http|\.request|\.api|redis|mongo|postgres|sql|graphql/i;

const SEMANTIC_NAME_KEYWORDS = /\b(query|fetch|request|api|redis|mongo|postgres|sql|graphql|http)\b/i;

function collectLeaves(node: FlowNode, accumulator: FlowNode[]): void {
  if (node.kind === 'leaf') {
    accumulator.push(node);
    return;
  }
  for (const child of node.children) {
    collectLeaves(child, accumulator);
  }
}

function lookupBuiltinComplexity(calleeName: string): string | undefined {
  if (STATIC_METHOD_COMPLEXITY[calleeName] !== undefined) {
    return STATIC_METHOD_COMPLEXITY[calleeName];
  }

  const methodName = calleeName.includes('.')
    ? calleeName.split('.').pop()!
    : calleeName;

  return BUILTIN_METHOD_COMPLEXITY[methodName];
}

function isSemanticCallee(calleeName: string): boolean {
  return SEMANTIC_CALLEE_PATTERN.test(calleeName) || SEMANTIC_NAME_KEYWORDS.test(calleeName);
}


function classifyLeaf(node: FlowNode): ClassifiedLeaf {
  const calleeName = node.metadata.calleeName ?? '';
  const isExternal = node.metadata.isExternal === true;

  // DB/API patterns take priority over builtin matches
  if (calleeName && isSemanticCallee(calleeName)) {
    return {
      node,
      classification: 'semantic',
      reason: `Callee '${calleeName}' matches database/API/network pattern — requires LLM evaluation`,
    };
  }

  if (calleeName) {
    const builtinComplexity = lookupBuiltinComplexity(calleeName);
    if (builtinComplexity !== undefined) {
      return {
        node,
        classification: 'deterministic',
        reason: `Callee '${calleeName}' is a known builtin with complexity ${builtinComplexity}`,
        builtinComplexity,
      };
    }
  }

  if (isExternal) {
    return {
      node,
      classification: 'semantic',
      reason: calleeName
        ? `External call to '${calleeName}' is not in the builtin lookup table — requires LLM evaluation`
        : 'External call (unresolvable) — requires LLM evaluation',
    };
  }

  return {
    node,
    classification: 'deterministic',
    reason: 'Simple expression with no external calls or loops — O(1) deterministic',
  };
}


export interface LeafClassifier {
  classify(flowTree: FlowNode): ClassificationResult;
}

export function createLeafClassifier(): LeafClassifier {
  return {
    classify(flowTree: FlowNode): ClassificationResult {
      const leafNodes: FlowNode[] = [];
      collectLeaves(flowTree, leafNodes);

      const leaves: ClassifiedLeaf[] = leafNodes.map(classifyLeaf);

      const deterministicCount = leaves.filter(
        (l) => l.classification === 'deterministic',
      ).length;
      const semanticCount = leaves.filter(
        (l) => l.classification === 'semantic',
      ).length;

      return {
        leaves,
        deterministicCount,
        semanticCount,
      };
    },
  };
}
