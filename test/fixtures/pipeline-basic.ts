/**
 * @analyze-complexity
 * @complexity-input items
 */
export function processItems(items: number[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item;
  }
  return sum;
}
