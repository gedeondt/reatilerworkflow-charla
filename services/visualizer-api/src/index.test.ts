import axios from 'axios';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { loadScenario, type Scenario } from '@reatiler/saga-kernel';
import { app, applyEventToState, type TraceView, __testing } from './index.js';

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

describe('GET /scenario', () => {
  it('returns the normalized active business scenario', async () => {
    const expected = loadScenario('retailer-happy-path');

    const response = await app.inject({ method: 'GET', url: '/scenario' });

    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      name: string;
      source: string;
      definition: Scenario;
    };

    expect(payload).toMatchObject({
      name: 'retailer-happy-path',
      source: 'business',
    });
    expect(payload.definition).toEqual(expected);
  });

  it('returns the normalized active draft scenario', async () => {
    const scenario = loadScenario('retailer-happy-path');
    const now = new Date().toISOString();

    __testing.registerDynamicScenario({
      name: 'draft-scenario',
      definition: scenario,
      origin: { type: 'draft', draftId: 'draft-1' },
      appliedAt: now,
    });
    __testing.setActiveScenarioName('draft-scenario', 'draft');

    const response = await app.inject({ method: 'GET', url: '/scenario' });

    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      name: string;
      source: string;
      definition: Scenario;
    };

    expect(payload).toMatchObject({ name: 'draft-scenario', source: 'draft' });
    expect(payload.definition).toEqual(scenario);
  });
});

describe('GET /scenarios/:name/definition', () => {
  it('returns the normalized definition for a business scenario', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/scenarios/retailer-happy-path/definition',
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json() as { name: string; definition: Scenario };

    expect(payload.name).toBe('retailer-happy-path');
    expect(payload.definition).toEqual(loadScenario('retailer-happy-path'));
  });

  it('returns 404 when the scenario is unknown', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/scenarios/does-not-exist/definition',
    });

    expect(response.statusCode).toBe(404);

    const payload = response.json() as { error: string; message: string };

    expect(payload).toEqual({
      error: 'not_found',
      message: "Scenario 'does-not-exist' not found",
    });
  });
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
      rawEvent: {
        traceId: 'trace-1',
        domain: 'payments',
        eventName: 'PaymentCreated',
        occurredAt,
      },
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
      rawEvent: {
        traceId: 'trace-1',
        domain: 'payments',
        eventName: 'PaymentSettled',
        occurredAt,
      },
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
      rawEvent: {
        traceId: 'trace-123',
        domain: 'orders',
        eventName: 'OrderPlaced',
        occurredAt: '2024-01-01T00:00:00.000Z',
      },
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:3200/kv/custom-scenario/trace%3Atrace-123',
      expect.any(Object),
    );
  });
});

describe('normalizeVisualizerPayload', () => {
  it('normalizes an enveloped queue message', () => {
    const payload = {
      message: {
        queue: 'orders',
        message: {
          traceId: 'trace-1',
          eventName: 'OrderPlaced',
          occurredAt: '2024-01-01T00:00:00.000Z',
        },
      },
    };

    const result = __testing.normalizeVisualizerPayload(payload);

    expect(result).toEqual({
      traceId: 'trace-1',
      domain: 'orders',
      eventName: 'OrderPlaced',
      occurredAt: '2024-01-01T00:00:00.000Z',
      rawEvent: {
        traceId: 'trace-1',
        eventName: 'OrderPlaced',
        occurredAt: '2024-01-01T00:00:00.000Z',
      },
      queue: 'orders',
      originalPayload: payload,
    });
  });

  it('falls back to correlationId and UnknownEvent', () => {
    const payload = {
      message: {
        queue: 'payments',
        message: {
          correlationId: 'corr-123',
        },
      },
    };

    const result = __testing.normalizeVisualizerPayload(payload);

    expect(result).toEqual({
      traceId: 'corr-123',
      domain: 'payments',
      eventName: 'UnknownEvent',
      occurredAt: expect.any(String),
      rawEvent: {
        correlationId: 'corr-123',
      },
      queue: 'payments',
      originalPayload: payload,
    });
  });

  it('handles already normalized events without envelope', () => {
    const payload = {
      eventName: 'StandaloneEvent',
      traceId: 'standalone-trace',
      occurredAt: '2024-02-02T00:00:00.000Z',
      domain: 'standalone',
    };

    const result = __testing.normalizeVisualizerPayload(payload);

    expect(result).toEqual({
      traceId: 'standalone-trace',
      domain: 'standalone',
      eventName: 'StandaloneEvent',
      occurredAt: '2024-02-02T00:00:00.000Z',
      rawEvent: {
        eventName: 'StandaloneEvent',
        traceId: 'standalone-trace',
        occurredAt: '2024-02-02T00:00:00.000Z',
        domain: 'standalone',
      },
      originalPayload: payload,
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

  it('rejects drafts whose generated scenario uses top-level definitions', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'legacy-draft',
          status: 'ready',
          currentProposal: { name: 'legacy-saga' },
          hasGeneratedScenario: true,
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          name: 'legacy-saga',
          version: 1,
          events: [],
          listeners: [],
          domains: [
            {
              id: 'ventas',
              queue: 'ventas',
              events: [
                { name: 'PedidoCreado', payloadSchema: { pedidoId: 'string' } },
              ],
            },
          ],
        },
      });

    const response = await app.inject({
      method: 'POST',
      url: '/scenario/apply',
      payload: { type: 'draft', draftId: 'legacy-draft' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: 'invalid_scenario_definition',
      message: 'Generated scenario JSON is invalid.',
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(__testing.getActiveScenario()).toEqual({
      name: 'retailer-happy-path',
      source: 'business',
    });
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
          domains: [
            {
              id: 'ventas',
              queue: 'ventas',
              events: [
                { name: 'PedidoCreado', payloadSchema: { pedidoId: 'string' } }
              ],
              listeners: [
                {
                  id: 'ventas-on-PedidoCreado',
                  on: { event: 'PedidoCreado' },
                  actions: [
                    { type: 'set-state', status: 'RECIBIDO' }
                  ]
                }
              ]
            }
          ]
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'draft-2',
          generatedScenario: {
            content: {
              name: 'dynamic-saga',
              version: 1,
              domains: [
                {
                  id: 'ventas',
                  queue: 'ventas',
                  events: [
                    { name: 'PedidoCreado', payloadSchema: { pedidoId: 'string' } }
                  ],
                  listeners: [
                    {
                      id: 'ventas-on-PedidoCreado',
                      on: { event: 'PedidoCreado' },
                      actions: [
                        {
                          type: 'set-state',
                          status: 'RECIBIDO'
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            createdAt: '2024-01-01T00:00:00.000Z',
            bootstrapExample: {
              queue: 'ventas',
              event: {
                eventName: 'PedidoCreado',
                version: 1,
                eventId: 'evt-1',
                traceId: 'trace-1',
                correlationId: 'saga-1',
                occurredAt: '2024-01-01T00:00:00.000Z',
                data: { pedidoId: 'PED-1' },
              },
            },
          },
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
    expect(dynamicScenarios[0]).toHaveProperty('bootstrapExample.queue', 'ventas');
    expect(dynamicScenarios[0]?.bootstrapExample?.event).toMatchObject({
      eventName: 'PedidoCreado',
      data: { pedidoId: 'PED-1' },
    });

    expect(__testing.getActiveScenario()).toEqual({
      name: 'dynamic-saga',
      source: 'draft',
    });

    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    expect(mockedAxios.get.mock.calls[0][0]).toContain('/summary');
    expect(mockedAxios.get.mock.calls[1][0]).toContain('/json');
    expect(mockedAxios.get.mock.calls[2][0]).toMatch(/\/scenario-drafts\/draft-2$/u);
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
    const definition: Scenario = {
      name: 'from-draft',
      version: 1,
      domains: [
        {
          id: 'order',
          queue: 'orders',
          events: [
            { name: 'OrderPlaced', payloadSchema: { orderId: 'string' } }
          ],
          listeners: [
            {
              id: 'order-on-OrderPlaced',
              on: { event: 'OrderPlaced' },
              actions: [
                {
                  type: 'emit',
                  event: 'OrderPlaced',
                  toDomain: 'order',
                  mapping: {
                    orderId: 'orderId'
                  }
                }
              ]
            }
          ]
        }
      ]
    } as const;

    __testing.registerDynamicScenario({
      name: 'from-draft',
      definition,
      origin: { type: 'draft', draftId: 'draft-xyz' },
      appliedAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/scenario-definition?name=from-draft',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(definition);
  });
});

describe('GET /scenario-bootstrap', () => {
  it('returns hasBootstrap false when the active scenario is from business', async () => {
    __testing.setActiveScenarioName('retailer-happy-path', 'business');

    const response = await app.inject({ method: 'GET', url: '/scenario-bootstrap' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hasBootstrap: false });
  });

  it('returns the stored bootstrap for the active draft scenario', async () => {
    const definition: Scenario = {
      name: 'dynamic-saga',
      version: 1,
      domains: [
        {
          id: 'ventas',
          queue: 'ventas',
          events: [
            { name: 'PedidoCreado', payloadSchema: { pedidoId: 'string' } }
          ],
          listeners: [
            {
              id: 'ventas-on-PedidoCreado',
              on: { event: 'PedidoCreado' },
              actions: [
                {
                  type: 'emit',
                  event: 'PedidoCreado',
                  toDomain: 'ventas',
                  mapping: {
                    pedidoId: 'pedidoId'
                  }
                }
              ]
            }
          ]
        }
      ]
    } as const;

    __testing.registerDynamicScenario({
      name: 'dynamic-saga',
      definition,
      origin: { type: 'draft', draftId: 'draft-abc' },
      appliedAt: '2024-01-01T00:00:00.000Z',
      bootstrapExample: {
        queue: 'ventas',
        event: {
          eventName: 'PedidoCreado',
          version: 1,
          eventId: 'evt-1',
          traceId: 'trace-1',
          correlationId: 'saga-1',
          occurredAt: '2024-01-01T00:00:00.000Z',
          data: { pedidoId: 'PED-9' },
        },
      },
    });

    __testing.setActiveScenarioName('dynamic-saga', 'draft');

    const response = await app.inject({ method: 'GET', url: '/scenario-bootstrap' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      hasBootstrap: true,
      queue: 'ventas',
      event: expect.objectContaining({
        eventName: 'PedidoCreado',
        data: { pedidoId: 'PED-9' },
      }),
    });
  });
});
