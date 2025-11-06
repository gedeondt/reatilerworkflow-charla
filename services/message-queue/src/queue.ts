import type { EventEnvelope } from '@reatiler/shared';
const queues = new Map<string, EventEnvelope[]>();
export function push(name: string, ev: EventEnvelope) {
  const q = queues.get(name) ?? [];
  q.push(ev);
  queues.set(name, q);
}
export function pop(name: string): EventEnvelope | null {
  const q = queues.get(name) ?? [];
  const msg = q.shift() ?? null;
  queues.set(name, q);
  return msg;
}
export function _reset() { queues.clear(); }
