import { EventEnvelope } from './types.js';

export class InMemoryQueue {
  private readonly queues = new Map<string, EventEnvelope[]>();

  push(queueName: string, message: EventEnvelope) {
    const queue = this.queues.get(queueName) ?? [];
    queue.push(message);
    this.queues.set(queueName, queue);
  }

  pop(queueName: string): EventEnvelope | null {
    const queue = this.queues.get(queueName);
    if (!queue || queue.length === 0) {
      return null;
    }

    const message = queue.shift() ?? null;

    if (queue.length === 0) {
      this.queues.delete(queueName);
    } else {
      this.queues.set(queueName, queue);
    }

    return message;
  }

  size(queueName: string) {
    return this.queues.get(queueName)?.length ?? 0;
  }
}
