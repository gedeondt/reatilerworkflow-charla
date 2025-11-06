import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../src/events/dispatcher.js';
import type { EventEnvelope } from '@reatiler/shared';

describe('order dispatcher', () => {
  const baseEvent: EventEnvelope = {
    eventName: 'OrderPlaced',
    version: 1,
    eventId: 'evt-1',
    traceId: 'trace-1',
    correlationId: 'corr-1',
    occurredAt: new Date().toISOString(),
    data: {}
  };

  it('invoca el handler registrado para el evento', async () => {
    const logger = { info: vi.fn() };
    const dispatcher = createDispatcher(logger);
    const handler = vi.fn();

    dispatcher.registerHandler('OrderPlaced', handler);

    const handled = await dispatcher.dispatch(baseEvent);

    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledWith(baseEvent);
  });

  it('retorna false para eventos desconocidos', async () => {
    const logger = { info: vi.fn() };
    const dispatcher = createDispatcher(logger);

    const handled = await dispatcher.dispatch({
      ...baseEvent,
      eventName: 'UnknownEvent',
      eventId: 'evt-2'
    });

    expect(handled).toBe(false);
    expect(logger.info).toHaveBeenCalled();
  });
});
