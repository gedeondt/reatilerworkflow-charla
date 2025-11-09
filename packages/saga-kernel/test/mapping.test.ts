import { describe, expect, it, vi } from 'vitest';

import { applyEmitMapping, type MappingWarning } from '../src/mapping.js';
import type { EmitMapping, PayloadSchema } from '../src/schema.js';

describe('applyEmitMapping', () => {
  it('maps scalars, objects and arrays according to the schema', () => {
    const destinationSchema: PayloadSchema = {
      orderId: 'string',
      amount: 'number',
      status: 'string',
      address: {
        line1: 'string',
        city: 'string'
      },
      lines: [
        {
          sku: 'string',
          qty: 'number'
        }
      ]
    };

    const mapping: EmitMapping = {
      orderId: 'orderId',
      amount: 'totalAmount',
      status: { const: 'CONFIRMED' },
      address: {
        objectFrom: 'shippingAddress',
        map: {
          line1: 'line1',
          city: 'city'
        }
      },
      lines: {
        arrayFrom: 'items',
        map: {
          sku: 'sku',
          qty: 'quantity'
        }
      }
    };

    const sourcePayload = {
      orderId: 'ORD-9',
      totalAmount: 199.99,
      shippingAddress: {
        line1: 'Gran Via 1',
        city: 'Madrid',
        zip: '28013'
      },
      items: [
        { sku: 'SKU-1', quantity: 1 },
        { sku: 'SKU-2', quantity: 3 }
      ]
    } as const;

    const result = applyEmitMapping({
      sourcePayload,
      destinationSchema,
      mapping
    });

    expect(result).toEqual({
      orderId: 'ORD-9',
      amount: 199.99,
      status: 'CONFIRMED',
      address: {
        line1: 'Gran Via 1',
        city: 'Madrid'
      },
      lines: [
        { sku: 'SKU-1', qty: 1 },
        { sku: 'SKU-2', qty: 3 }
      ]
    });
  });

  it('reports warnings when mappings cannot be resolved', () => {
    const destinationSchema: PayloadSchema = {
      orderId: 'string',
      amount: 'number',
      status: 'string'
    };

    const mapping: EmitMapping = {
      orderId: { from: 'missingOrderId' },
      amount: 'amount',
      status: { const: true }
    };

    const sourcePayload = { amount: 'not-a-number' };
    const warn = vi.fn<(warning: MappingWarning) => void>();

    const result = applyEmitMapping({
      sourcePayload,
      destinationSchema,
      mapping,
      warn
    });

    expect(result).toEqual({});
    expect(warn).toHaveBeenCalled();
    const messages = warn.mock.calls.map(([warning]) => warning.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Field "missingOrderId" is missing in source payload',
        'Field "amount" has incompatible type for destination "number"',
        'Constant value is incompatible with type "string"'
      ])
    );
  });
});
