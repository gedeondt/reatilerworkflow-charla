const queues = new Map<string, unknown[]>();

export function push<T>(name: string, item: T) {
  const q = (queues.get(name) as T[] | undefined) ?? [];
  q.push(item);
  queues.set(name, q);
}

export function pop<T>(name: string): T | null {
  const q = (queues.get(name) as T[] | undefined) ?? [];
  const msg = q.shift() ?? null;
  queues.set(name, q);
  return msg;
}

export function _reset() {
  queues.clear();
}
