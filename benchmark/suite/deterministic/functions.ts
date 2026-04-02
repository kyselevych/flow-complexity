/** @analyze-complexity */
export function constant(): number {
  return 42;
}

/** @analyze-complexity @complexity-input items */
export function linearSearch(items: number[], target: number): number {
  for (let i = 0; i < items.length; i++) {
    if (items[i] === target) return i;
  }
  return -1;
}

/** @analyze-complexity @complexity-input matrix */
export function nestedLoop(matrix: number[][]): number {
  let sum = 0;
  for (const row of matrix) {
    for (const val of row) {
      sum += val;
    }
  }
  return sum;
}

/** @analyze-complexity @complexity-input items */
export function tripleNested(items: number[]): number {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      for (let k = 0; k < items.length; k++) {
        count++;
      }
    }
  }
  return count;
}

/** @analyze-complexity @complexity-input items */
export function binarySearchIterative(items: number[], target: number): number {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (items[mid] === target) return mid;
    if (items[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** @analyze-complexity @complexity-input items */
export function twoPointers(items: number[]): boolean {
  let left = 0;
  let right = items.length - 1;
  while (left < right) {
    if (items[left] + items[right] === 0) return true;
    if (items[left] + items[right] < 0) left++;
    else right--;
  }
  return false;
}

/** @analyze-complexity @complexity-input items */
export function bubbleSort(items: number[]): number[] {
  const arr = [...items];
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        const tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
      }
    }
  }
  return arr;
}

/** @analyze-complexity @complexity-input items */
export function selectionSort(items: number[]): number[] {
  const arr = [...items];
  for (let i = 0; i < arr.length; i++) {
    let minIdx = i;
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j] < arr[minIdx]) minIdx = j;
    }
    if (minIdx !== i) {
      const tmp = arr[i];
      arr[i] = arr[minIdx];
      arr[minIdx] = tmp;
    }
  }
  return arr;
}

/** @analyze-complexity @complexity-input items */
export function arraySum(items: number[]): number {
  let total = 0;
  for (const x of items) {
    total += x;
  }
  return total;
}

/** @analyze-complexity @complexity-input items */
export function findMax(items: number[]): number {
  let max = items[0];
  for (let i = 1; i < items.length; i++) {
    if (items[i] > max) max = items[i];
  }
  return max;
}

/** @analyze-complexity @complexity-input matrix */
export function matrixDiagonal(matrix: number[][]): number[] {
  const diag: number[] = [];
  for (let i = 0; i < matrix.length; i++) {
    diag.push(matrix[i][i]);
  }
  return diag;
}

/** @analyze-complexity @complexity-input items */
export function countOccurrences(items: number[], target: number): number {
  let count = 0;
  for (const x of items) {
    if (x === target) count++;
  }
  return count;
}

/** @analyze-complexity @complexity-input items */
export function reverseArray(items: number[]): number[] {
  const result: number[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    result.push(items[i]);
  }
  return result;
}

/** @analyze-complexity @complexity-input items */
export function isPalindrome(items: number[]): boolean {
  let left = 0;
  let right = items.length - 1;
  while (left < right) {
    if (items[left] !== items[right]) return false;
    left++;
    right--;
  }
  return true;
}

/** @analyze-complexity @complexity-input items */
export function prefixSum(items: number[]): number[] {
  const prefix: number[] = new Array(items.length).fill(0);
  for (let i = 0; i < items.length; i++) {
    prefix[i] = i === 0 ? items[0] : prefix[i - 1] + items[i];
  }
  const result: number[] = [];
  for (let i = 0; i < prefix.length; i++) {
    result.push(prefix[i]);
  }
  return result;
}
