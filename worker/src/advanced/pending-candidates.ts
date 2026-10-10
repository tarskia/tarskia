import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeWorkspaceJsonArtifact } from '../artifacts';
import type { Logger } from '../logger';
import { type Diagnostic, diagramDiagnostic, parseDocument } from '../semantic';
import { emptyTokenUsageTotals } from '../token-usage';
import type { PreparedWorkspace } from '../workspace';
import type { AdvancedCheckpointStage } from './types';
import { parseWave1ReviewPatchResponse } from './wave1-review';

/** Unaccepted model candidates are repair inputs, never completed stage checkpoints. */
export class PendingStageCandidates {
  constructor(
    private readonly workspace: PreparedWorkspace,
    private readonly enabled: boolean,
    private readonly fingerprint: (stage: AdvancedCheckpointStage) => string,
    private readonly logger: Logger,
  ) {}
  private file(stage: AdvancedCheckpointStage, key = '') {
    return `analysis/pending-${stage}${key ? `-${key}` : ''}.json`;
  }
  async load<T>(
    stage: AdvancedCheckpointStage,
    decode: (value: unknown) => T,
    key = '',
  ): Promise<T | undefined> {
    if (!this.enabled) return;
    const file = this.file(stage, key);
    try {
      const saved: unknown = JSON.parse(
        await fs.readFile(path.join(this.workspace.workspaceOutputDir, file), 'utf8'),
      );
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('fingerprint' in saved) ||
        saved.fingerprint !== this.fingerprint(stage) ||
        !('value' in saved)
      )
        return;
      return decode(saved.value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.logger.warn(
          `Ignoring pending candidate ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  }
  async save(stage: AdvancedCheckpointStage, value: unknown, key = '') {
    await writeWorkspaceJsonArtifact(this.workspace, this.file(stage, key), {
      fingerprint: this.fingerprint(stage),
      value,
    });
  }
}

export function decodePendingDocument(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('rawYaml' in value) ||
    typeof value.rawYaml !== 'string' ||
    !('rawResponse' in value) ||
    typeof value.rawResponse !== 'string' ||
    !('repairCount' in value) ||
    typeof value.repairCount !== 'number' ||
    !Number.isSafeInteger(value.repairCount) ||
    value.repairCount < 0 ||
    !('diagnostics' in value) ||
    !Array.isArray(value.diagnostics)
  )
    throw new Error('invalid pending document shape');
  const diagnostics: Diagnostic[] = value.diagnostics.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('code' in entry) ||
      typeof entry.code !== 'string' ||
      !('message' in entry) ||
      typeof entry.message !== 'string'
    )
      throw new Error('invalid pending diagnostic');
    return diagramDiagnostic({
      phase: 'document',
      severity: 'error',
      code: entry.code,
      message: entry.message,
    });
  });
  return {
    result: {
      rawYaml: value.rawYaml,
      rawResponse: value.rawResponse,
      doc: parseDocument(value.rawYaml),
      threadId: null,
    },
    repairCount: value.repairCount,
    diagnostics,
  };
}

export function decodePendingAreaAttempt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3)
    throw new Error('invalid pending area-plan attempt');
  return value as number;
}

export function decodePendingWave1(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('invalid pending wave-1 state');
  const saved = value as Record<string, unknown>;
  for (const key of ['repairCount', 'turnsUsed']) {
    if (!Number.isSafeInteger(saved[key]) || (saved[key] as number) < 0)
      throw new Error('invalid pending wave-1 counters');
  }
  if (!Array.isArray(saved.diagnostics)) throw new Error('invalid pending wave-1 diagnostics');
  const diagnostics = saved.diagnostics.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('code' in entry) ||
      typeof entry.code !== 'string' ||
      !('message' in entry) ||
      typeof entry.message !== 'string'
    )
      throw new Error('invalid pending diagnostic');
    return diagramDiagnostic({
      phase: 'document',
      severity: 'error',
      code: entry.code,
      message: entry.message,
    });
  });
  const tokenUsage = emptyTokenUsageTotals();
  if (!saved.tokenUsage || typeof saved.tokenUsage !== 'object')
    throw new Error('invalid pending wave-1 usage');
  for (const key of Object.keys(tokenUsage) as Array<keyof typeof tokenUsage>) {
    const count = (saved.tokenUsage as Record<string, unknown>)[key];
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0)
      throw new Error('invalid pending wave-1 usage');
    tokenUsage[key] = count;
  }
  return {
    patch: parseWave1ReviewPatchResponse(JSON.stringify(saved.patch)),
    diagnostics,
    tokenUsage,
    repairCount: saved.repairCount as number,
    turnsUsed: saved.turnsUsed as number,
  };
}
