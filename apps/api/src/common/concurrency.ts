/**
 * A small concurrency limiter: `const limit = pLimit(8)`, then `limit(() => work())` runs at most 8 at once and
 * queues the rest. Used where one request fans out into many independent database reads, so they overlap instead
 * of waiting for each other, without flooding the connection pool.
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}
