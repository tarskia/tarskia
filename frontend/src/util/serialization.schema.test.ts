import { parseSchema } from '@tarskia/diagram-semantics';
import { describe, expect, it } from 'vitest';
import baseRaw from '../../../packages/diagram-semantics/core-schemas/base.yaml?raw';
import codeRaw from '../../../packages/diagram-semantics/core-schemas/code.yaml?raw';
import dataModelRaw from '../../../packages/diagram-semantics/core-schemas/data-model.yaml?raw';
import frontendRaw from '../../../packages/diagram-semantics/core-schemas/frontend.yaml?raw';
import kubernetesRaw from '../../../packages/diagram-semantics/core-schemas/kubernetes.yaml?raw';
import softwareRaw from '../../../packages/diagram-semantics/core-schemas/software.yaml?raw';
import webAppRaw from '../../../packages/diagram-semantics/core-schemas/web-app.yaml?raw';
import clickhouseRaw from '../schemas/clickhouse.yaml?raw';

describe('parseSchema validation', () => {
  it('accepts current bundled schema modules', () => {
    expect(() => parseSchema(baseRaw)).not.toThrow();
    expect(() => parseSchema(softwareRaw)).not.toThrow();
    expect(() => parseSchema(webAppRaw)).not.toThrow();
    expect(() => parseSchema(codeRaw)).not.toThrow();
    expect(() => parseSchema(frontendRaw)).not.toThrow();
    expect(() => parseSchema(dataModelRaw)).not.toThrow();
    expect(() => parseSchema(kubernetesRaw)).not.toThrow();
    expect(() => parseSchema(clickhouseRaw)).not.toThrow();
  });

  it('accepts entity types without labels', () => {
    const raw = `
owner: user
name: label-free
version: 1.0.0
types:
  - id: application
relations: []
`.trim();

    expect(() => parseSchema(raw)).not.toThrow();
  });

  it('rejects legacy top-level display fields', () => {
    const raw = `
owner: user
name: invalid
version: 1.0.0
types:
  - id: application
    label: Application
    defaultSize:
      width: 180
      height: 80
relations: []
`.trim();
    expect(() => parseSchema(raw)).toThrowError(/\$\.types\[0\]\.defaultSize: is not allowed/);
  });

  it('rejects non-positive relation priority values', () => {
    const raw = `
owner: user
name: invalid-priority
version: 1.0.0
types:
  - id: application
    label: Application
relations:
  - id: reads
    label: reads
    priority: 0
`.trim();
    expect(() => parseSchema(raw)).toThrowError(/\$\.relations\[0\]\.priority: expected >= 1/);
  });

  it('rejects legacy module-level extends declarations', () => {
    const raw = `
owner: user
name: legacy
version: 1.0.0
extends:
  - core/web-app
types: []
relations: []
`.trim();
    expect(() => parseSchema(raw)).toThrowError(/\$\.extends: is not allowed/);
  });

  it('rejects legacy flat analysis fields', () => {
    const raw = `
owner: user
name: legacy-analysis
version: 1.0.0
traits:
  - id: interface
    label: Interface
    mayTerminate: true
types: []
relations: []
`.trim();
    expect(() => parseSchema(raw)).toThrowError(/\$\.traits\[0\]\.mayTerminate: is not allowed/);
  });
});
