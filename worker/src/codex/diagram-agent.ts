import type { ThreadEvent, ThreadItem, ThreadOptions, TurnOptions, Usage } from '@openai/codex-sdk';
import { assertYamlInputSize, YamlInputError } from '../untrusted-yaml';

export interface CodexThreadLike {
  id: string | null;
  runStreamed?(
    prompt: string,
    turnOptions?: TurnOptions,
  ): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
  run(
    prompt: string,
    turnOptions?: TurnOptions,
  ): Promise<{
    finalResponse: string;
    items: ThreadItem[];
    usage: Usage | null;
  }>;
}

export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread?(id: string, options?: ThreadOptions): CodexThreadLike;
}

function extractYamlLikeResponse(response: string, rootKeys: string[]): string {
  try {
    assertYamlInputSize(response);
  } catch (error) {
    if (!(error instanceof YamlInputError)) throw error;
    return response;
  }
  const trimmed = response.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { yaml?: unknown };
      if (typeof parsed.yaml === 'string' && parsed.yaml.trim().length > 0) {
        return parsed.yaml.trim();
      }
    } catch {
      // Fall through to raw/fenced handling.
    }
  }

  const fencedMatch = trimmed.match(/```(?:yaml)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  let firstRootKeyStart: number | null = null;
  for (const rootKey of rootKeys) {
    const rootKeyMatch = new RegExp(`(^|\\n)${rootKey}:\\s*[^\\n]+`).exec(trimmed);
    if (!rootKeyMatch) {
      continue;
    }
    const rootKeyStart =
      trimmed[rootKeyMatch.index] === '\n' ? rootKeyMatch.index + 1 : rootKeyMatch.index;
    if (firstRootKeyStart === null || rootKeyStart < firstRootKeyStart) {
      firstRootKeyStart = rootKeyStart;
    }
  }
  if (firstRootKeyStart !== null) {
    return trimmed.slice(firstRootKeyStart).trim();
  }

  return trimmed;
}

export function extractYamlResponse(response: string): string {
  return extractYamlLikeResponse(response, ['version']);
}

export function extractSchemaModuleYamlResponse(response: string): string {
  return extractYamlLikeResponse(response, ['owner']);
}
