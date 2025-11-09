import axios from 'axios';
import { app, applyEventToState, type TraceView, __testing } from './index.js';
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

beforeEach(() => {
  mockedAxios.get.mockReset();
  mockedAxios.put.mockReset();
  mockedAxios.post.mockReset();
  __testing.resetLogBuffer();
  __testing.clearDynamicScenarios();
  __testing.setActiveScenarioName('retailer-happy-path');
});

describe('applyEventToState', () => {
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

  it('uses the active scenario namespace when persisting state', async () => {
    __testing.setActiveScenarioName('custom-scenario');

    mockedAxios.get.mockResolvedValueOnce({ status: 404 });
    mockedAxios.put.mockResolvedValueOnce({ status: 204 });

    await applyEventToState({
      traceId: 'trace-123',
      domain: 'orders',
      eventName: 'OrderPlaced',
      occurredAt: '2024-01-01T00:00:00.000Z',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:3200/kv/custom-scenario/trace%3Atrace-123',
      expect.any(Object),
    );
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

describe('POST /scenario/apply', () => {
  it('activates an existing business scenario', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/scenario/apply',
      payload: { type: 'existing', name: 'retailer-happy-path' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'retailer-happy-path',
      status: 'active',
      source: 'business',
    });

    expect(__testing.getActiveScenario()).toEqual({
      name: 'retailer-happy-path',
      source: 'business',
    });
  });

  it('rejects drafts that are not ready', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: {
        id: 'draft-1',
        status: 'draft',
        currentProposal: { name: 'pending-draft' },
        hasGeneratedScenario: true,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/scenario/apply',
      payload: { type: 'draft', draftId: 'draft-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'draft_not_ready' });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('applies a ready draft and registers the dynamic scenario', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'draft-2',
          status: 'ready',
          currentProposal: { name: 'approved-draft' },
          hasGeneratedScenario: true,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          name: 'dynamic-saga',
          version: 1,
          domains: [],
          listeners: [],
        },
      });

    const response = await app.inject({
      method: 'POST',
      url: '/scenario/apply',
      payload: { type: 'draft', draftId: 'draft-2' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'dynamic-saga',
      status: 'active',
      source: 'draft',
    });

    const dynamicScenarios = __testing.listDynamicScenarios();
    expect(dynamicScenarios).toHaveLength(1);
    expect(dynamicScenarios[0]).toMatchObject({
      name: 'dynamic-saga',
      origin: { type: 'draft', draftId: 'draft-2' },
    });

    expect(__testing.getActiveScenario()).toEqual({
      name: 'dynamic-saga',
      source: 'draft',
    });

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get.mock.calls[0][0]).toContain('/summary');
    expect(mockedAxios.get.mock.calls[1][0]).toContain('/json');
  });
});

describe('GET /scenario-definition', () => {
  it('returns 404 when the scenario is not registered', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/scenario-definition?name=unknown',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns the registered dynamic scenario definition', async () => {
    __testing.registerDynamicScenario({
      name: 'from-draft',
      definition: { name: 'from-draft', version: 1, domains: [], listeners: [] },
      origin: { type: 'draft', draftId: 'draft-xyz' },
      appliedAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/scenario-definition?name=from-draft',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'from-draft',
      source: 'draft',
      definition: { name: 'from-draft', version: 1, domains: [], listeners: [] },
      origin: { type: 'draft', draftId: 'draft-xyz' },
      appliedAt: '2024-01-01T00:00:00.000Z',
    });
  });
});
