import { describe, expect, it } from 'vitest';
import baseRaw from '../schemas/base.yaml?raw';
import clickhouseRaw from '../schemas/clickhouse.yaml?raw';
import codeRaw from '../schemas/code.yaml?raw';
import dataModelRaw from '../schemas/data-model.yaml?raw';
import frontendRaw from '../schemas/frontend.yaml?raw';
import kubernetesRaw from '../schemas/kubernetes.yaml?raw';
import softwareRaw from '../schemas/software.yaml?raw';
import webAppRaw from '../schemas/web-app.yaml?raw';
import { parseSchema } from './serialization';

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
