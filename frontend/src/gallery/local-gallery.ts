import { load } from 'js-yaml';
import manifest from '../../../gallery/curated/manifest.json';
import type {
  getGalleryDiagramResponse,
  listGalleryDiagramsResponse,
} from '../api/generated/gallery/gallery';
import type {
  DtoGalleryDiagramDetailResponse,
  DtoGalleryDiagramSourceRepositorySummary,
  DtoGalleryDiagramSummaryResponse,
  DtoGalleryDiagramWorkerBuildSummary,
} from '../api/generated/model';

type LocalGalleryManifestEntry = {
  namespace: string;
  slug: string;
  title: string;
  file: string;
  visibility: 'listed' | 'retired';
  starter?: boolean;
};

type LocalDiagramMetadata = {
  name?: unknown;
  description?: unknown;
  workerBuild?: Record<string, unknown>;
  sourceRepository?: Record<string, unknown>;
};

type LocalDiagramDocument = {
  metadata?: LocalDiagramMetadata;
};

const localDiagramRawModules = import.meta.glob<string>('../../../gallery/curated/*.yaml', {
  eager: true,
  import: 'default',
  query: '?raw',
});

const localDiagramRawByFile = new Map(
  Object.entries(localDiagramRawModules).map(([filePath, raw]) => [
    filePath.split('/').pop() ?? filePath,
    raw,
  ]),
);

const headers = new Headers({ 'content-type': 'application/json' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : undefined;

const readNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const parseLocalDiagramMetadata = (raw: string): LocalDiagramMetadata => {
  const parsed = load(raw) as LocalDiagramDocument | undefined;
  return isRecord(parsed?.metadata) ? parsed.metadata : {};
};

const readWorkerBuild = (
  metadata: LocalDiagramMetadata,
): DtoGalleryDiagramWorkerBuildSummary | undefined => {
  if (!isRecord(metadata.workerBuild)) {
    return undefined;
  }
  return {
    model: readString(metadata.workerBuild.model),
    durationMs: readNumber(metadata.workerBuild.durationMs),
    approxTotalTokens: readNumber(metadata.workerBuild.approxTotalTokens),
    turns: readNumber(metadata.workerBuild.turns),
    nodes: readNumber(metadata.workerBuild.nodes),
  };
};

const readSourceRepository = (
  metadata: LocalDiagramMetadata,
): DtoGalleryDiagramSourceRepositorySummary | undefined => {
  if (!isRecord(metadata.sourceRepository)) {
    return undefined;
  }
  return {
    repo: readString(metadata.sourceRepository.repo),
    url: readString(metadata.sourceRepository.url),
    ref: readString(metadata.sourceRepository.ref),
    commit: readString(metadata.sourceRepository.commit),
    committedAt: readString(metadata.sourceRepository.committedAt),
  };
};

const readUpdatedAt = (metadata: LocalDiagramMetadata) => {
  if (isRecord(metadata.workerBuild)) {
    const builtAt = readString(metadata.workerBuild.builtAt);
    if (builtAt) {
      return builtAt;
    }
  }
  if (isRecord(metadata.sourceRepository)) {
    return readString(metadata.sourceRepository.committedAt);
  }
  return undefined;
};

const readTextMetadata = (metadata: LocalDiagramMetadata) => {
  const description = readString(metadata.description);
  return {
    ...(description ? { description } : {}),
  };
};

const toSummary = (
  entry: LocalGalleryManifestEntry,
  raw: string,
): DtoGalleryDiagramSummaryResponse => {
  const metadata = parseLocalDiagramMetadata(raw);
  return {
    namespace: entry.namespace,
    slug: entry.slug,
    title: readString(metadata.name) ?? entry.title,
    updatedAt: readUpdatedAt(metadata),
    workerBuild: readWorkerBuild(metadata),
    sourceRepository: readSourceRepository(metadata),
    ...readTextMetadata(metadata),
  };
};

const toDetail = (
  entry: LocalGalleryManifestEntry,
  raw: string,
): DtoGalleryDiagramDetailResponse => {
  const metadata = parseLocalDiagramMetadata(raw);
  return {
    namespace: entry.namespace,
    slug: entry.slug,
    title: readString(metadata.name) ?? entry.title,
    raw,
    visibility: entry.visibility,
    checkpointedAt: readUpdatedAt(metadata),
    ...readTextMetadata(metadata),
  };
};

const localManifest = manifest as LocalGalleryManifestEntry[];

export const listLocalGalleryDiagrams = async (): Promise<listGalleryDiagramsResponse> => ({
  status: 200,
  headers,
  data: localManifest.flatMap((entry) => {
    if (entry.visibility !== 'listed') {
      return [];
    }
    const raw = localDiagramRawByFile.get(entry.file);
    return raw ? [toSummary(entry, raw)] : [];
  }),
});

export const getLocalGalleryDiagram = async (
  namespace: string,
  slug: string,
): Promise<getGalleryDiagramResponse> => {
  const entry = localManifest.find(
    (candidate) =>
      candidate.namespace === namespace &&
      candidate.slug === slug &&
      candidate.visibility === 'listed',
  );
  const raw = entry ? localDiagramRawByFile.get(entry.file) : undefined;
  if (!entry || !raw) {
    return {
      status: 404,
      headers,
      data: { message: 'Gallery diagram not found.' },
    };
  }
  return {
    status: 200,
    headers,
    data: toDetail(entry, raw),
  };
};

const hasConfiguredGalleryApi = () => Boolean(import.meta.env.VITE_API_BASE_URL?.trim());

export const shouldUseLocalGallerySource = () =>
  import.meta.env.VITE_GALLERY_SOURCE === 'local' ||
  (import.meta.env.VITE_GALLERY_SOURCE !== 'api' &&
    !hasConfiguredGalleryApi() &&
    import.meta.env.DEV);

export const shouldUseLocalGalleryFallback = () =>
  import.meta.env.VITE_GALLERY_SOURCE !== 'api' &&
  !hasConfiguredGalleryApi() &&
  import.meta.env.DEV;
