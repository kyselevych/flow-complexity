/**
 * @analyze-complexity
 * @complexity-input items
 */
export function simpleLoop(items: string[]): number {
  let count = 0;
  for (const item of items) {
    count++;
  }
  return count;
}

/** Not annotated */
export function notAnnotated(): void {
  console.log('hello');
}

/**
 * @analyze-complexity
 */
export const arrowFunc = (data: number[]): number[] => {
  return data.filter(x => x > 0);
};
