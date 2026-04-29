import { describe, expect, it } from 'vitest';
import { diagnosticsToMessages } from './diagnostics';
import { removeEntitiesFromDocument } from './document-mutations';
import { commitHistory, createHistory, redoHistory, undoHistory } from './history';
import { mergeSchemas } from './schema';
import { buildSchemaActivation } from './schema-ref';
import {
  buildNextSchemaActivations,
  collectIntroducedValidationErrors,
  type SchemaCatalogEntry,
} from './schema-selection';
import type { SchemaModule, SemanticDocument } from './types';

const act = (schema: string, layer = 0) => buildSchemaActivation(schema, layer);

const baseModule: SchemaModule = {
  owner: 'user',
  name: 'base',
  version: '1.0.0',
  types: [{ id: 'service', label: 'Service' }],
  relations: [],
};

const deploymentModule: SchemaModule = {
  owner: 'user',
  name: 'deployment',
  version: '1.0.0',
  use: [{ schema: 'user/base@1.0.0', alias: 'base' }],
  traits: [
    {
      id: 'deployer',
      label: 'Deployer',
      relationParticipation: [{ relation: 'deploys-to', endpoint: 'from' }],
    },
    {
      id: 'deploy-target-like',
      label: 'Deploy Target-like',
      relationParticipation: [{ relation: 'deploys-to', endpoint: 'to' }],
    },
  ],
  types: [{ id: 'deploy-target', label: 'Deploy Target', traits: ['deploy-target-like'] }],
  relations: [{ id: 'deploys-to', label: 'deploys-to' }],
  update: {
    'base.types.service': {
      add: {
        traits: ['user/deployment.traits.deployer'],
      },
    },
  },
};

describe('controller boundary (history + semantics APIs)', () => {
  it('supports delete->undo/redo and schema deselection validation flow', () => {
    const schemaCatalog: SchemaCatalogEntry[] = [
      { id: 'user/base', owner: 'user', label: 'Base', version: '1.0.0' },
      { id: 'user/deployment', owner: 'user', label: 'Deployment', version: '1.0.0' },
    ];
    const bothSchema = mergeSchemas([baseModule, deploymentModule]);
    const baseSchema = mergeSchemas([baseModule]);

    const initialDoc: SemanticDocument = {
      version: '1',
      schemaRefs: [act('user/base@1.0.0'), act('user/deployment@1.0.0')],
      entities: [
        { id: 'svc-orders', type: 'service', name: 'Orders' },
        { id: 'deploy-orders', type: 'deploy-target', name: 'orders-deploy' },
      ],
      relations: [
        { id: 'rel-deploy', type: 'deploys-to', from: 'svc-orders', to: 'deploy-orders' },
      ],
    };

    // Attempting to remove deployment schema while deployment entities still exist should fail.
    const refsWithoutDeployment = buildNextSchemaActivations({
      currentActivations: initialDoc.schemaRefs,
      selectedSchemaIds: ['user/base'],
      schemaCatalog,
    });
    const blockedCandidateDoc: SemanticDocument = {
      ...initialDoc,
      schemaRefs: refsWithoutDeployment,
    };
    const blocked = collectIntroducedValidationErrors({
      currentDoc: initialDoc,
      candidateDoc: blockedCandidateDoc,
      currentSchema: bothSchema,
      candidateSchema: baseSchema,
    });
    expect(
      diagnosticsToMessages(blocked.introducedDiagnostics).some((error) =>
        error.includes('unknown type deploy-target'),
      ),
    ).toBe(true);

    // Delete deployment subtree, then schema deselection should pass.
    let history = createHistory(initialDoc);
    history = commitHistory(history, (prev) => removeEntitiesFromDocument(prev, ['deploy-orders']));
    expect(history.present.relations).toEqual([]);
    expect(history.past).toHaveLength(1);

    const allowedCandidateDoc: SemanticDocument = {
      ...history.present,
      schemaRefs: refsWithoutDeployment,
    };
    const allowed = collectIntroducedValidationErrors({
      currentDoc: history.present,
      candidateDoc: allowedCandidateDoc,
      currentSchema: bothSchema,
      candidateSchema: baseSchema,
    });
    expect(allowed.introducedDiagnostics).toEqual([]);

    // History boundary still behaves as expected.
    history = undoHistory(history);
    expect(history.present.entities.some((entity) => entity.id === 'deploy-orders')).toBe(true);
    history = redoHistory(history);
    expect(history.present.entities.some((entity) => entity.id === 'deploy-orders')).toBe(false);
  });
});
