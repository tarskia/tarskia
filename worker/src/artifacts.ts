import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PreparedWorkspace } from './workspace';
import { writeFileAtomic } from './write-file-atomic';

function withTrailingNewline(contents: string): string {
  return contents.endsWith('\n') ? contents : `${contents}\n`;
}

export async function writeWorkspaceArtifact(
  workspace: PreparedWorkspace,
  fileName: string,
  contents: string,
): Promise<string> {
  const artifactPath = path.join(workspace.workspaceOutputDir, fileName);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFileAtomic(artifactPath, withTrailingNewline(contents));
  return artifactPath;
}

export async function writeWorkspaceJsonArtifact(
  workspace: PreparedWorkspace,
  fileName: string,
  value: unknown,
): Promise<string> {
  const artifactPath = path.join(workspace.workspaceOutputDir, fileName);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFileAtomic(artifactPath, `${JSON.stringify(value, null, 2)}\n`);
  return artifactPath;
}
