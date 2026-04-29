import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer } from 'testcontainers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const backendRoot = path.join(repoRoot, 'backend');
const backendDbRoot = path.join(backendRoot, 'db');

const getAvailablePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to resolve an ephemeral port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });

const runCommand = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      reject(
        new Error(
          `Failed to start ${command}: ${error.message}. Ensure ${command} is installed and available on PATH.`,
        ),
      );
    });

    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });

const waitForHealthyHttp = async (baseUrl: string, timeoutMs: number, onFailure: () => string) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Backend did not become healthy within ${timeoutMs}ms.\n${onFailure()}`);
};

export default async function globalSetup() {
  const container = await new GenericContainer('postgres:18')
    .withEnvironment({
      POSTGRES_DB: 'diagram_test',
      POSTGRES_USER: 'dev_user',
      POSTGRES_PASSWORD: 'dev_password',
    })
    .withExposedPorts(5432)
    .start();

  const databaseUrl = `postgres://dev_user:dev_password@${container.getHost()}:${container.getMappedPort(5432)}/diagram_test?sslmode=disable`;

  await runCommand(
    'atlas',
    ['migrate', 'apply', '--dir', 'file://migrations', '--url', databaseUrl],
    {
      cwd: backendDbRoot,
    },
  );

  const backendPort = await getAvailablePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const backendProcess = spawn('go', ['run', './cmd/diagram-backend'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      ENV: 'test',
      DATABASE_URL: databaseUrl,
      PORT: String(backendPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let backendStdout = '';
  let backendStderr = '';

  backendProcess.stdout.on('data', (chunk) => {
    backendStdout += chunk.toString();
  });
  backendProcess.stderr.on('data', (chunk) => {
    backendStderr += chunk.toString();
  });

  const backendExit = new Promise<void>((resolve, reject) => {
    backendProcess.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') {
        resolve();
        return;
      }
      reject(
        new Error(
          `Backend exited before teardown (code=${code}, signal=${signal}).\nstdout:\n${backendStdout}\nstderr:\n${backendStderr}`,
        ),
      );
    });
    backendProcess.once('error', (error) => {
      reject(new Error(`Failed to start backend process: ${error.message}`));
    });
  });

  await waitForHealthyHttp(
    backendUrl,
    60_000,
    () => `stdout:\n${backendStdout}\nstderr:\n${backendStderr}`,
  );
  process.env.VITE_API_BASE_URL = backendUrl;

  return async () => {
    backendProcess.kill('SIGTERM');
    try {
      await Promise.race([backendExit, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    } finally {
      await container.stop();
    }
  };
}
