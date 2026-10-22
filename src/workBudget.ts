// Detached DOM work still runs on the UI thread. Give input and painting a turn
// between short batches, and stop obsolete snapshots before doing more work.
export function workBudget(signal?: AbortSignal) {
  let started = performance.now();
  return (): Promise<void> | undefined => {
    signal?.throwIfAborted();
    if (performance.now() - started < 5) return;
    return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      signal?.throwIfAborted();
      started = performance.now();
    });
  };
}
