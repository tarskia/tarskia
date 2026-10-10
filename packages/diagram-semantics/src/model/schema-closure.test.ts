import { describe, expect, it } from 'vitest';
import {
  buildQualifiedSchemaObjectId,
  buildRawSchemaSet,
  buildSchemaActivation,
  buildSchemaRuntime,
  buildSchemaSelection,
  buildSchemaVersionCatalogFromRegistry,
  type SchemaModule,
} from '../index';
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

describe('shared catalog exports and unresolved activations', () => {
  it('builds a version catalog from registry modules', () => {
    const catalog = buildSchemaVersionCatalogFromRegistry(
      new Map([
        ['user/payments', paymentsV1],
        ['user/orders', ordersV1],
      ]),
    );
    const result = buildSchemaRuntimeFromCatalog({
      catalog,
      activations: [act('user/orders@1.0')],
    });
    expect(result.ok).toBe(true);
    expect(result.runtime.indexes.typesById.get(PAYMENTS_TYPE_ID)?.label).toBe('Payments v1');
    expect(catalog.entriesByRef.has('user/payments@1.0')).toBe(true);
  });

  it('rejects an unavailable pinned root version', () => {
    const catalog = buildSchemaVersionCatalogFromRegistry(new Map([['user/payments', paymentsV1]]));
    const result = buildSchemaRuntimeFromCatalog({
      catalog,
      activations: [act('user/payments@99.0')],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'schema.resolution.missing_dependency',
        message: 'Missing schema dependency: user/payments@99.0',
      }),
    );
  });

  it('rejects unpinned dependencies without changing unpinned root selection', () => {
    const catalog = buildSchemaVersionCatalogFromRegistry(
      new Map([
        ['user/payments', paymentsV1],
        ['user/orders', { ...ordersV1, use: [{ schema: 'user/payments', alias: 'payments' }] }],
      ]),
    );
    const result = buildSchemaRuntimeFromCatalog({ catalog, activations: [act('user/orders')] });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'schema.resolution.unpinned_dependency' }),
    );
  });

  it('retains unknown roots and reports the same missing dependency as catalog resolution', () => {
    const raw = buildRawSchemaSet([paymentsV1]);
    const activations = [act('user/unknown'), act('user/payments')];
    const selection = buildSchemaSelection({ raw, activations });
    const runtime = buildSchemaRuntime({ raw, selection });
    const catalog = buildSchemaVersionCatalogFromRegistry(raw.modulesById);
    const catalogResult = buildSchemaRuntimeFromCatalog({ catalog, activations });
    expect(selection.rootModuleIds).toEqual(['user/payments', 'user/unknown']);
    expect(selection.rootActivations).toEqual([activations[1], activations[0]]);
    expect(runtime.resolved.diagnostics).toEqual(catalogResult.diagnostics);
    expect(runtime.resolved.diagnostics).toEqual([
      expect.objectContaining({
        code: 'schema.resolution.missing_dependency',
        moduleId: 'user/unknown',
      }),
    ]);
    expect(runtime.indexes.typesById.has(PAYMENTS_TYPE_ID)).toBe(true);
  });

  it('keeps default selection and explicit empty selection behavior', () => {
    const raw = buildRawSchemaSet([paymentsV1]);
    expect(buildSchemaSelection({ raw }).rootModuleIds).toEqual(['user/payments']);
    expect(buildSchemaSelection({ raw, activations: [] }).rootModuleIds).toEqual([]);
  });
});
