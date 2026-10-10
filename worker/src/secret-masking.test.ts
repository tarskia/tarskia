import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCancellation } from './cancellation';
import {
  emptyBuildSecrets,
  formatSecretsAlert,
  maskRepository,
  redactOutputDocument,
} from './secret-masking';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secret-mask-'));
  temporary.push(dir);
  return dir;
}
const token = () => ['ghp', randomBytes(18).toString('hex')].join('_');

describe('secret masking', () => {
  it('masks repeated values despite disable comments, preserves unchanged bytes and skips binary files', async () => {
    const root = await directory();
    const secret = token();
    const clean = Buffer.from([0xff, 0xfe, 0x61]);
    await fs.writeFile(path.join(root, 'clean.txt'), clean);
    await fs.writeFile(
      path.join(root, 'binary'),
      Buffer.concat([Buffer.from([0]), Buffer.from(secret)]),
    );
    await fs.writeFile(path.join(root, 'keys.txt'), `// secretlint-disable\n${secret}\n${secret}`);
    const logger = { info: vi.fn() };
    const result = await maskRepository(root, logger);
    expect(result.maskedFiles).toBe(1);
    expect(result.maskedSecrets).toBeGreaterThan(0);
    expect(result.files).toEqual([{ path: 'keys.txt', rules: ['github'] }]);
    expect(await fs.readFile(path.join(root, 'keys.txt'), 'utf8')).not.toContain(secret);
    expect(await fs.readFile(path.join(root, 'clean.txt'))).toEqual(clean);
    expect((await fs.readFile(path.join(root, 'binary'))).includes(Buffer.from(secret))).toBe(true);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(secret);
  });

  it('masks every required provider, PEM private key and password-bearing database URI', async () => {
    const root = await directory();
    const alpha = (length: number) => randomBytes(length).toString('hex').slice(0, length);
    const keys = [
      randomBytes(20).toString('hex'),
      token(),
      ['sk-', alpha(20), 'T3BlbkFJ', alpha(20)].join(''),
      ['sk-ant-api03-', alpha(93), 'AA'].join(''),
      ['xoxb', alpha(12), alpha(12), alpha(24)].join('-'),
      ['sk', 'live', alpha(32)].join('_'),
    ];
    await fs.writeFile(
      path.join(root, '.env'),
      keys
        .map((key, index) => `${index === 0 ? 'aws_secret_access_key' : `key${index}`} = ${key}`)
        .join('\n'),
    );
    const pem = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    await fs.writeFile(path.join(root, 'private.pem'), pem);
    const password = alpha(32);
    await fs.writeFile(
      path.join(root, 'database.ts'),
      `const url = "postgresql://service:${password}@db.internal/app";`,
    );
    const result = await maskRepository(root);
    expect(result.maskedFiles).toBe(3);
    expect(new Set(result.files.flatMap((file) => file.rules))).toEqual(
      new Set([
        'aws',
        'github',
        'openai',
        'anthropic',
        'slack',
        'stripe',
        'privatekey',
        'database-connection-string',
      ]),
    );
    const output = (
      await Promise.all(
        ['.env', 'private.pem', 'database.ts'].map((file) =>
          fs.readFile(path.join(root, file), 'utf8'),
        ),
      )
    ).join('\n');
    for (const secret of [...keys, password, pem]) {
      for (let index = 0; index <= secret.length - 8; index++)
        expect(output).not.toContain(secret.slice(index, index + 8));
    }
  });

  it('retains a detection when the only masking write fails without claiming it was masked', async () => {
    const root = await directory();
    const secret = token();
    await fs.writeFile(path.join(root, 'key.env'), secret);
    const rename = vi
      .spyOn(fs, 'rename')
      .mockRejectedValue(new Error('injected sole write failure'));
    const progress = vi.fn();
    try {
      await expect(maskRepository(root, undefined, progress)).rejects.toThrow(
        'injected sole write failure',
      );
      const [masked, unmasked] = progress.mock.lastCall ?? [];
      expect(masked).toEqual({ maskedFiles: 0, maskedSecrets: 0, files: [] });
      expect(unmasked).toEqual({ count: 1, files: [{ path: 'key.env', rules: ['github'] }] });
      const report = emptyBuildSecrets();
      const alert = formatSecretsAlert(report, unmasked);
      expect(alert).toContain('found 1 possible secrets');
      expect(alert).toContain('github in key.env');
      expect(alert).toContain('Masking could not complete; the build stopped before analysis.');
      expect(alert).not.toContain('They were masked');
      expect(alert).not.toContain(secret);
      expect(report).toEqual({ maskedInRepo: 0, files: [], redactedFromOutput: 0 });
      expect(await fs.readFile(path.join(root, 'key.env'), 'utf8')).toBe(secret);
    } finally {
      rename.mockRestore();
    }
  });

  it('awaits surviving workers and their progress before rejecting a failed write', async () => {
    const root = await directory();
    await fs.writeFile(path.join(root, 'bad'), token());
    await fs.writeFile(path.join(root, 'slow'), token());
    const originalRename = fs.rename.bind(fs);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (String(destination).endsWith('/bad')) throw new Error('injected write failure');
      await gate;
      return originalRename(source, destination);
    });
    const progress = vi.fn();
    let settled = false;
    const result = maskRepository(root, undefined, progress)
      .then(
        () => undefined,
        (error: Error) => error,
      )
      .finally(() => {
        settled = true;
      });
    try {
      await vi.waitFor(() => expect(rename).toHaveBeenCalledTimes(2));
      expect(settled).toBe(false);
      release();
      expect((await result)?.message).toBe('injected write failure');
      expect(await fs.readFile(path.join(root, 'slow'), 'utf8')).toBe('[REDACTED]');
      expect(progress.mock.lastCall?.[0].maskedFiles).toBe(1);
    } finally {
      release();
      await result;
      rename.mockRestore();
    }
  });

  it('stops starting files after cancellation and settles all progress before returning', async () => {
    const root = await directory();
    for (let index = 0; index < 12; index++)
      await fs.writeFile(path.join(root, String(index)), token());
    const controller = new AbortController();
    const progress = vi.fn(() => controller.abort(new Error('cancelled fixture')));
    await expect(
      withCancellation(controller.signal, () => maskRepository(root, undefined, progress)),
    ).rejects.toThrow('cancelled fixture');
    const count = progress.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(13);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(progress).toHaveBeenCalledTimes(count);
  });

  it('preserves invalid UTF8 around a match, reports progress, and retains unrelated performance marks', async () => {
    const root = await directory();
    const secret = token();
    await fs.writeFile(
      path.join(root, 'mixed'),
      Buffer.concat([Buffer.from([255]), Buffer.from(secret), Buffer.from([254])]),
    );
    const progress = vi.fn();
    performance.mark('worker-test-unrelated');
    const before = performance.getEntriesByType('mark').length;
    const result = await maskRepository(root, undefined, progress);
    expect(await fs.readFile(path.join(root, 'mixed'))).toEqual(
      Buffer.concat([Buffer.from([255]), Buffer.from('[REDACTED]'), Buffer.from([254])]),
    );
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls[2][0]).toEqual(result);
    expect(performance.getEntriesByType('mark')).toHaveLength(before);
    expect(performance.getEntriesByName('worker-test-unrelated')).toHaveLength(1);
    performance.clearMarks('worker-test-unrelated');
  });

  it('uses the AWS data value rather than the incorrect contextual range', async () => {
    const root = await directory();
    const secret = randomBytes(20).toString('hex');
    await fs.writeFile(path.join(root, '.env'), `aws_secret_access_key = ${secret}`);
    const result = await maskRepository(root);
    expect(result.maskedFiles).toBe(1);
    expect(await fs.readFile(path.join(root, '.env'), 'utf8')).toBe(
      'aws_secret_access_key = [REDACTED]',
    );
  });

  it('removes outbound and chained symlinks without touching targets or following internal links', async () => {
    const root = await directory();
    const outside = await directory();
    await fs.writeFile(path.join(outside, 'key'), token());
    const before = await fs.readFile(path.join(outside, 'key'));
    await fs.symlink(path.join(outside, 'key'), path.join(root, 'out'));
    await fs.symlink('out', path.join(root, 'z-chain'));
    await fs.writeFile(path.join(root, 'safe'), 'safe');
    await fs.symlink('safe', path.join(root, 'inside'));
    await maskRepository(root);
    await expect(fs.lstat(path.join(root, 'out'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(root, 'z-chain'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.lstat(path.join(root, 'inside'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(outside, 'key'))).toEqual(before);
  });

  it('redacts only free text and leaves structural fields and the original document intact', async () => {
    const secret = token();
    const doc = {
      schemaRefs: [{ schema: secret }],
      entities: [
        {
          id: secret,
          type: secret,
          parent: secret,
          name: secret,
          description: secret,
          props: { nested: [secret] },
          provenance: {
            notes: secret,
            locations: [{ path: secret, input: secret, commit: secret }],
          },
        },
      ],
      relations: [{ id: 'edge', from: secret, to: secret, type: secret, label: secret }],
      metadata: { value: secret },
    };
    const result = await redactOutputDocument(doc);
    expect(result.document.entities[0].name).toBe('[REDACTED]');
    expect(result.document.entities[0].props.nested).toEqual(['[REDACTED]']);
    expect(result.document.entities[0].provenance.notes).toBe('[REDACTED]');
    expect(result.document.entities[0].provenance.locations).toEqual(
      doc.entities[0].provenance.locations,
    );
    expect(result.document.entities[0].id).toBe(secret);
    expect(result.document.entities[0].type).toBe(secret);
    expect(result.document.relations[0].from).toBe(secret);
    expect(result.document.schemaRefs).toEqual(doc.schemaRefs);
    expect(doc.entities[0].name).toBe(secret);
    expect(result.redactions.length).toBe(6);
  });

  it('does not redact curated n8n or worker YAML fixtures', async () => {
    const files = [path.resolve('../gallery/curated/n8n.yaml')];
    async function collect(directory: string): Promise<void> {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await collect(filename);
        else if (/\.ya?ml$/.test(entry.name)) files.push(filename);
      }
    }
    await collect(path.resolve('test/fixtures'));
    for (const filename of files) {
      const document = load(await fs.readFile(filename, 'utf8'));
      expect((await redactOutputDocument(document)).redactions, filename).toEqual([]);
    }
  });

  it('preserves schema names while masking descriptions and metadata', async () => {
    const secret = token();
    const doc = {
      name: secret,
      types: { service: { name: secret, description: secret } },
      metadata: { value: secret },
    };
    const result = await redactOutputDocument(doc, { kind: 'schema' });
    expect(result.document.name).toBe(secret);
    expect(result.document.types.service.name).toBe(secret);
    expect(result.document.types.service.description).toBe('[REDACTED]');
    expect(result.redactions).toHaveLength(2);
  });
});
