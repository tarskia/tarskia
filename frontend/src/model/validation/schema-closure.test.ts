import { describe, expect, it } from 'vitest';
import { buildQualifiedSchemaObjectId } from '../schema-ids';
import { buildSchemaActivation } from '../schema-ref';
import type { SchemaModule } from '../types';
import { buildSchemaRuntimeFromCatalog, buildSchemaVersionCatalog } from './schema-closure';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const PAYMENTS_TYPE_ID = buildQualifiedSchemaObjectId('user/payments', 'types', 'payments-service');
const ORDERS_TYPE_ID = buildQualifiedSchemaObjectId('user/orders', 'types', 'orders-service');

const paymentsV1: SchemaModule = {
  owner: 'user',
  name: 'payments',
  version: '1.0',
  types: [{ id: 'payments-service', label: 'Payments v1' }],
  relations: [],
};

const paymentsV2: SchemaModule = {
  owner: 'user',
  name: 'payments',
  version: '2.0',
  types: [{ id: 'payments-service', label: 'Payments v2' }],
  relations: [],
};

const ordersV1: SchemaModule = {
  owner: 'user',
  name: 'orders',
  version: '1.0',
  use: [{ schema: 'user/payments@1.0', alias: 'payments' }],
  types: [{ id: 'orders-service', label: 'Orders v1' }],
  relations: [],
};

const ordersV2: SchemaModule = {
  owner: 'user',
  name: 'orders',
  version: '2.0',
  use: [{ schema: 'user/payments@2.0', alias: 'payments' }],
  types: [{ id: 'orders-service', label: 'Orders v2' }],
  relations: [],
};

describe('schema catalog runtime', () => {
  it('resolves the exact pinned root version instead of the latest version', () => {
    const catalog = buildSchemaVersionCatalog([
      {
        schemaId: 'user/payments',
        version: '1.0',
        raw: 'payments-v1',
        module: paymentsV1,
      },
      {
        schemaId: 'user/payments',
        version: '2.0',
        raw: 'payments-v2',
        module: paymentsV2,
      },
    ]);

    const result = buildSchemaRuntimeFromCatalog({
      catalog,
      activations: [act('user/payments@1.0')],
    });

    expect(result.ok).toBe(true);
    expect(result.runtime.indexes.typesById.get(PAYMENTS_TYPE_ID)?.label).toBe('Payments v1');
  });

  it('resolves pinned dependencies from the matching published versions', () => {
    const catalog = buildSchemaVersionCatalog([
      {
        schemaId: 'user/payments',
        version: '1.0',
        raw: 'payments-v1',
        module: paymentsV1,
      },
      {
        schemaId: 'user/payments',
        version: '2.0',
        raw: 'payments-v2',
        module: paymentsV2,
      },
      {
        schemaId: 'user/orders',
        version: '1.0',
        raw: 'orders-v1',
        module: ordersV1,
      },
      {
        schemaId: 'user/orders',
        version: '2.0',
        raw: 'orders-v2',
        module: ordersV2,
      },
    ]);

    const result = buildSchemaRuntimeFromCatalog({
      catalog,
      activations: [act('user/orders@1.0')],
    });

    expect(result.ok).toBe(true);
    expect(result.runtime.indexes.typesById.get(ORDERS_TYPE_ID)?.label).toBe('Orders v1');
    expect(result.runtime.indexes.typesById.get(PAYMENTS_TYPE_ID)?.label).toBe('Payments v1');
  });

  it('defaults unpinned root refs to the latest published version', () => {
    const catalog = buildSchemaVersionCatalog([
      {
        schemaId: 'user/payments',
        version: '1.0',
        raw: 'payments-v1',
        module: paymentsV1,
      },
      {
        schemaId: 'user/payments',
        version: '2.0',
        raw: 'payments-v2',
        module: paymentsV2,
      },
    ]);

    const result = buildSchemaRuntimeFromCatalog({
      catalog,
      activations: [act('user/payments')],
    });

    expect(result.ok).toBe(true);
    expect(result.runtime.indexes.typesById.get(PAYMENTS_TYPE_ID)?.label).toBe('Payments v2');
  });
});
