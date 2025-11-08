import axios from 'axios';
import { applyEventToState, type TraceView, __testing } from './index.js';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('axios', () => {
  const get = vi.fn();
  const put = vi.fn();
  const post = vi.fn();

  return {
    default: { get, put, post },
    get,
    put,
    post,
  };
});

type AxiosMock = {
  get: Mock;
  put: Mock;
  post: Mock;
};

const mockedAxios = axios as unknown as AxiosMock;

describe('applyEventToState', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.put.mockReset();
    __testing.resetLogBuffer();
  });

  it('creates a new trace when none exists', async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 404 });
    mockedAxios.put.mockResolvedValueOnce({ status: 204 });

    const occurredAt = '2024-01-01T00:00:00.000Z';

    await applyEventToState({
      traceId: 'trace-1',
      domain: 'payments',
      eventName: 'PaymentCreated',
      occurredAt,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:3200/kv/retailer-happy-path/trace%3Atrace-1',
      expect.any(Object),
    );

    expect(mockedAxios.put).toHaveBeenCalledWith(
      'http://localhost:3200/kv/retailer-happy-path/trace%3Atrace-1',
      {
        traceId: 'trace-1',
        lastUpdatedAt: occurredAt,
        domains: {
          payments: {
            events: [
              { eventName: 'PaymentCreated', occurredAt },
            ],
          },
        },
      },
    );
  });

  it('appends an event to an existing trace', async () => {
    const existing: TraceView = {
      traceId: 'trace-1',
      lastUpdatedAt: '2024-01-01T00:00:00.000Z',
      domains: {
        payments: {
          events: [
            {
              eventName: 'PaymentCreated',
              occurredAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        },
      },
    };

    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: existing });
    mockedAxios.put.mockResolvedValueOnce({ status: 204 });

    const occurredAt = '2024-01-02T00:00:00.000Z';

    await applyEventToState({
      traceId: 'trace-1',
      domain: 'payments',
      eventName: 'PaymentSettled',
      occurredAt,
    });

    expect(mockedAxios.put).toHaveBeenCalledTimes(1);

    const [, updated] = mockedAxios.put.mock.calls[0];
    const updatedTrace = updated as TraceView;

    expect(updatedTrace.lastUpdatedAt).toBe(occurredAt);
    expect(updatedTrace.domains.payments.events).toHaveLength(2);
    expect(updatedTrace.domains.payments.events[1]).toEqual({
      eventName: 'PaymentSettled',
      occurredAt,
    });
  });
});

describe('normalizeVisualizerPayload', () => {
  it('normalizes an enveloped queue message', () => {
    const result = __testing.normalizeVisualizerPayload({
      message: {
        queue: 'orders',
        message: {
          traceId: 'trace-1',
          eventName: 'OrderPlaced',
          occurredAt: '2024-01-01T00:00:00.000Z',
        },
      },
    });

    expect(result).toEqual({
      traceId: 'trace-1',
      domain: 'orders',
      eventName: 'OrderPlaced',
      occurredAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('falls back to correlationId and UnknownEvent', () => {
    const result = __testing.normalizeVisualizerPayload({
      message: {
        queue: 'payments',
        message: {
          correlationId: 'corr-123',
        },
      },
    });

    expect(result).toEqual({
      traceId: 'corr-123',
      domain: 'payments',
      eventName: 'UnknownEvent',
      occurredAt: expect.any(String),
    });
  });

  it('handles already normalized events without envelope', () => {
    const result = __testing.normalizeVisualizerPayload({
      eventName: 'StandaloneEvent',
      traceId: 'standalone-trace',
      occurredAt: '2024-02-02T00:00:00.000Z',
      domain: 'standalone',
    });

    expect(result).toEqual({
      traceId: 'standalone-trace',
      domain: 'standalone',
      eventName: 'StandaloneEvent',
      occurredAt: '2024-02-02T00:00:00.000Z',
    });
  });

  it('returns null for invalid payloads', () => {
    expect(__testing.normalizeVisualizerPayload(null)).toBeNull();
    expect(__testing.normalizeVisualizerPayload({ status: 'empty' })).toBeNull();
    expect(__testing.normalizeVisualizerPayload({ message: null })).toBeNull();
  });
});
