/** @analyze-complexity @complexity-input items */
export function sortWithLibrary(items: number[]): number[] {
  return [...items].sort((a, b) => a - b);
}
// Expected: O(n log n)

/** @analyze-complexity @complexity-input graph */
export function bfsTraversal(
  graph: Map<string, string[]>,
  start: string,
): string[] {
  const visited = new Set<string>();
  const queue: string[] = [start];
  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    result.push(node);
    for (const neighbor of graph.get(node) ?? []) {
      queue.push(neighbor);
    }
  }
  return result;
}
// Expected: O(n) where n = vertices + edges

/** @analyze-complexity @complexity-input graph */
export function dfsTraversal(
  graph: Map<string, string[]>,
  start: string,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(start)) return [];
  visited.add(start);
  const result: string[] = [start];
  for (const neighbor of graph.get(start) ?? []) {
    result.push(...dfsTraversal(graph, neighbor, visited));
  }
  return result;
}
// Expected: O(n) where n = vertices + edges

/** @analyze-complexity @complexity-input graph */
export function dijkstra(
  graph: Map<string, Array<{ node: string; weight: number }>>,
  start: string,
): Map<string, number> {
  const dist = new Map<string, number>();
  const visited = new Set<string>();

  for (const node of graph.keys()) {
    dist.set(node, Infinity);
  }
  dist.set(start, 0);

  while (true) {
    // Find unvisited node with minimum distance (naive O(n) scan)
    let current: string | null = null;
    let minDist = Infinity;
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < minDist) {
        minDist = d;
        current = node;
      }
    }
    if (current === null) break;

    visited.add(current);
    for (const { node: neighbor, weight } of graph.get(current) ?? []) {
      const newDist = (dist.get(current) ?? Infinity) + weight;
      if (newDist < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, newDist);
      }
    }
  }
  return dist;
}
// Expected: O(n^2) naive Dijkstra

/** @analyze-complexity @complexity-input n */
export function memoizedFibonacci(n: number): number {
  const memo = new Map<number, number>();
  function fib(k: number): number {
    if (k <= 1) return k;
    if (memo.has(k)) return memo.get(k)!;
    const result = fib(k - 1) + fib(k - 2);
    memo.set(k, result);
    return result;
  }
  return fib(n);
}
// Expected: O(n)

/** @analyze-complexity @complexity-input weights */
export function knapsack01(
  weights: number[],
  values: number[],
  capacity: number,
): number {
  const n = weights.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(capacity + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (weights[i - 1] <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - weights[i - 1]] + values[i - 1]);
      }
    }
  }
  return dp[n][capacity];
}
// Expected: O(n^2) where n = items * capacity

/** @analyze-complexity @complexity-input a */
export function longestCommonSubsequence(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}
// Expected: O(n^2)

/** @analyze-complexity @complexity-input items */
export function permutations(items: number[]): number[][] {
  const result: number[][] = [];
  function backtrack(current: number[], remaining: number[]): void {
    if (remaining.length === 0) {
      result.push([...current]);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      current.push(remaining[i]);
      backtrack(current, [...remaining.slice(0, i), ...remaining.slice(i + 1)]);
      current.pop();
    }
  }
  backtrack([], items);
  return result;
}
// Expected: O(n!)

/** @analyze-complexity @complexity-input items */
export function powerSet(items: number[]): number[][] {
  const result: number[][] = [[]];
  for (const item of items) {
    const newSubsets = result.map((subset) => [...subset, item]);
    result.push(...newSubsets);
  }
  return result;
}
// Expected: O(2^n)

/** @analyze-complexity @complexity-input items */
export function mergeSort(items: number[]): number[] {
  if (items.length <= 1) return items;
  const mid = Math.floor(items.length / 2);
  const left = mergeSort(items.slice(0, mid));
  const right = mergeSort(items.slice(mid));
  return merge(left, right);
}

function merge(a: number[], b: number[]): number[] {
  const result: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] <= b[j]) result.push(a[i++]);
    else result.push(b[j++]);
  }
  return [...result, ...a.slice(i), ...b.slice(j)];
}
// Expected: O(n log n)

/** @analyze-complexity @complexity-input items */
export function quickSort(items: number[]): number[] {
  if (items.length <= 1) return items;
  const pivot = items[Math.floor(items.length / 2)];
  const left = items.filter((x) => x < pivot);
  const middle = items.filter((x) => x === pivot);
  const right = items.filter((x) => x > pivot);
  return [...quickSort(left), ...middle, ...quickSort(right)];
}
// Expected: O(n^2) worst case / O(n log n) average

/** @analyze-complexity @complexity-input graph */
export function topologicalSort(graph: Map<string, string[]>): string[] {
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    for (const neighbor of graph.get(node) ?? []) {
      dfs(neighbor);
    }
    stack.push(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }
  return stack.reverse();
}
// Expected: O(n) where n = vertices + edges

/** @analyze-complexity @complexity-input a */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}
// Expected: O(n^2)

/** @analyze-complexity @complexity-input n */
export function nQueens(n: number): number[][] {
  const solutions: number[][] = [];
  const board = new Array(n).fill(-1);

  function isSafe(row: number, col: number): boolean {
    for (let r = 0; r < row; r++) {
      if (board[r] === col || Math.abs(board[r] - col) === Math.abs(r - row)) {
        return false;
      }
    }
    return true;
  }

  function solve(row: number): void {
    if (row === n) {
      solutions.push([...board]);
      return;
    }
    for (let col = 0; col < n; col++) {
      if (isSafe(row, col)) {
        board[row] = col;
        solve(row + 1);
        board[row] = -1;
      }
    }
  }

  solve(0);
  return solutions;
}
// Expected: O(n!)

/** @analyze-complexity @complexity-input items */
export function maxSubarrayKadane(items: number[]): number {
  let maxSoFar = items[0];
  let maxEndingHere = items[0];
  for (let i = 1; i < items.length; i++) {
    maxEndingHere = Math.max(items[i], maxEndingHere + items[i]);
    maxSoFar = Math.max(maxSoFar, maxEndingHere);
  }
  return maxSoFar;
}
// Expected: O(n)
