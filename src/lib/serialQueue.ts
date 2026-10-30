/** Per-key FIFO for async work that must not overlap. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

const queues = new Map<string, SerialQueue>()

export function serialQueueFor(key: string): SerialQueue {
  let q = queues.get(key)
  if (!q) {
    q = new SerialQueue()
    queues.set(key, q)
  }
  return q
}
