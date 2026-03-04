import type { PgPubSub } from "../pubsub.js";

export async function* iterateEvents<T>(
  pubsub: PgPubSub,
  channel: string,
  signal: AbortSignal,
): AsyncGenerator<T> {
  const queue: T[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const unsubscribe = await pubsub.subscribe(channel, (event) => {
    queue.push(event as T);
    resolve?.();
  });

  const onAbort = () => {
    done = true;
    resolve?.();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (!done) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => {
          resolve = r;
        });
        resolve = null;
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}
