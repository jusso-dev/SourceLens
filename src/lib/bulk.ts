export interface BulkProgress<T> {
  current: number;
  total: number;
  item: T;
  ok: boolean;
  error?: string;
}

export async function runBulk<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  onProgress?: (progress: BulkProgress<T>) => void | Promise<void>,
) {
  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ item: T; error: string }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      await fn(item, index);
      succeeded += 1;
      await onProgress?.({ current: index + 1, total: items.length, item, ok: true });
    } catch (err) {
      failed += 1;
      const error = err instanceof Error ? err.message : String(err);
      errors.push({ item, error });
      await onProgress?.({ current: index + 1, total: items.length, item, ok: false, error });
    }
  }

  return { total: items.length, succeeded, failed, errors };
}
