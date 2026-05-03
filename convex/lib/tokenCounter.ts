export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
