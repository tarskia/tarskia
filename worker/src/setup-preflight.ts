import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

import { currentCancellationSignal, throwIfCancelled } from './cancellation';
import { ConfigError } from './cli-errors';
export const CODEX_LOGIN_MESSAGE = "Codex isn't signed in. Run 'codex login' and try again.";
export const REQUIRED_UV_MESSAGE =
  '--graphify-hints required needs uv (https://docs.astral.sh/uv/).';
export interface SetupCheck {
  name: string;
  ok: boolean;
  warning?: boolean;
  detail: string;
}
export interface SetupProbes {
  codex: () => Promise<boolean>;
  uv: () => Promise<boolean>;
}
type CommandProbe = (file: string, args: string[]) => Promise<void>;

export function bundledCodexLauncher(): string {
  // Resolve through the installed SDK so the probe uses the CLI version it runs.
  const sdkRequire = createRequire(import.meta.resolve('@openai/codex-sdk'));
  return path.join(
    path.dirname(sdkRequire.resolve('@openai/codex/package.json')),
    'bin',
    'codex.js',
  );
}

export function createSetupProbes(
  run: CommandProbe = async (file, args) => {
    // Do not print login status output: it can include account details.
    throwIfCancelled();
    await exec(file, args, {
      timeout: 10000,
      maxBuffer: 64 * 1024,
      signal: currentCancellationSignal(),
    });
  },
): SetupProbes {
  return {
    codex: async () => {
      try {
        await run(process.execPath, [bundledCodexLauncher(), 'login', 'status']);
        return true;
      } catch {
        throwIfCancelled();
        return false;
      }
    },
    uv: async () => {
      try {
        await run('uv', ['--version']);
        return true;
      } catch {
        throwIfCancelled();
        return false;
      }
    },
  };
}

export async function checkSetup(probes: SetupProbes = createSetupProbes()): Promise<SetupCheck[]> {
  const [codex, uv] = await Promise.all([probes.codex(), probes.uv()]);
  return [
    {
      name: 'Codex',
      ok: codex,
      detail: codex ? 'bundled CLI installed and signed in' : CODEX_LOGIN_MESSAGE,
    },
    {
      name: 'uv',
      ok: uv,
      warning: !uv,
      detail: uv ? 'available' : 'not found; optional Graphify hints will be skipped',
    },
  ];
}

interface BuildSetup {
  model?: string;
  reasoningEffort?: string;
  graphifyHintsMode?: string;
}
export function explainModelEffortError(error: unknown, options: BuildSetup): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (!options.model || !options.reasoningEffort) return error;
  // Translate only identifiable model/effort failures; unrelated Codex messages survive intact.
  if (
    /reasoning[_. -]effort/i.test(message) &&
    /(?:not supported|unsupported|does(?:n't| not) support)/i.test(message)
  ) {
    return new ConfigError(
      `model '${options.model}' doesn't support reasoning effort '${options.reasoningEffort}'.`,
      { cause: error },
    );
  }
  return error;
}

export async function runBuildWithPreflight<T>(
  options: BuildSetup,
  build: () => Promise<T>,
  probes: SetupProbes = createSetupProbes(),
): Promise<T> {
  if (!(await probes.codex())) throw new ConfigError(CODEX_LOGIN_MESSAGE);
  if (options.graphifyHintsMode === 'required' && !(await probes.uv()))
    throw new ConfigError(REQUIRED_UV_MESSAGE);
  try {
    return await build();
  } catch (error) {
    throw explainModelEffortError(error, options);
  }
}
