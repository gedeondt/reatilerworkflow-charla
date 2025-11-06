import type { EventEnvelope } from '@reatiler/shared';

type Logger = {
  info: (message: unknown, ...args: unknown[]) => void;
  warn?: (message: unknown, ...args: unknown[]) => void;
};

type EventHandler = (event: EventEnvelope) => void | Promise<void>;

type Dispatcher = {
  registerHandler: (eventName: string, handler: EventHandler) => void;
  dispatch: (event: EventEnvelope) => Promise<boolean>;
};

export function createDispatcher(logger: Logger): Dispatcher {
  const handlers = new Map<string, EventHandler>();

  const registerHandler = (eventName: string, handler: EventHandler) => {
    handlers.set(eventName, handler);
  };

  const dispatch = async (event: EventEnvelope): Promise<boolean> => {
    const handler = handlers.get(event.eventName);

    if (handler) {
      await handler(event);
      return true;
    }

    const genericHandler = handlers.get('*');

    if (genericHandler) {
      await genericHandler(event);
    } else {
      logger.info(
        {
          eventName: event.eventName,
          correlationId: event.correlationId
        },
        'no handler registered for event'
      );
    }

    return false;
  };

  registerHandler('*', (event) => {
    logger.info(
      {
        eventName: event.eventName,
        correlationId: event.correlationId
      },
      'generic event handler'
    );
  });

  return {
    registerHandler,
    dispatch
  };
}

export type { Dispatcher };
