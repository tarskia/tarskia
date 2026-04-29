import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/generated/gallery/gallery', () => ({
  useListGalleryDiagrams: vi.fn(),
}));

import { useListGalleryDiagrams } from '../api/generated/gallery/gallery';
import { coerceGallerySummaryArray, coerceSuccessfulResponseBody } from './gallery-response';
import PublicGalleryIndex, {
  filterPublicGalleryRows,
  type SortDirection,
  type SortKey,
  sortPublicGalleryRows,
} from './PublicGalleryIndex';

const mockedUseListGalleryDiagrams = vi.mocked(useListGalleryDiagrams);

const buildRows = () => [
  {
    namespace: 'tarskia',
    slug: 'outline',
    title: 'Outline',
    sourceRepository: {
      url: 'https://github.com/outline/outline',
      repo: 'git@github.com:outline/outline.git',
      commit: 'eefa8d422289a378c0e4cc4bb730ece7372b40b3',
    },
    workerBuild: {
      approxTotalTokens: 21282403,
      model: 'gpt-5.4-mini',
      nodes: 23,
    },
  },
  {
    namespace: 'tarskia',
    slug: 'harbor',
    title: 'Harbor',
  },
  {
    namespace: 'tarskia',
    slug: 'coolify',
    title: 'Coolify',
    sourceRepository: {
      url: 'https://gitlab.example.com/example/coolify',
    },
    workerBuild: {
      approxTotalTokens: 1200,
    },
  },
];

describe('PublicGalleryIndex', () => {
  it('renders a lean public gallery table with repository-first rows', () => {
    mockedUseListGalleryDiagrams.mockReturnValue({
      isPending: false,
      data: {
        status: 200,
        data: buildRows(),
      },
    } as never);

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PublicGalleryIndex />
      </MemoryRouter>,
    );

    expect(html).toContain('Search gallery');
    expect(html).toContain('AI-generated, schema-validated architecture diagrams');
    expect(html).toContain('may miss or misclassify implementation details');
    expect(html).toContain('Report diagram issue');
    expect(html).toContain(
      'href="https://github.com/tarskia/tarskia/issues/new?template=diagram_issue.yml"',
    );
    expect(html).toContain('Request a repo');
    expect(html).toContain(
      'href="https://github.com/tarskia/tarskia/issues/new?template=repo_request.yml"',
    );
    expect(html).not.toContain('Diagram Gallery');
    expect(html).toContain('Repository');
    expect(html).toContain('Nodes');
    expect(html).toContain('Tokens');
    expect(html).toContain('outline/outline');
    expect(html).toContain('>GitHub<');
    expect(html).toContain('href="https://github.com/outline/outline"');
    expect(html).not.toContain('<div class="text-sm text-muted-foreground">tarskia</div>');
    expect(html).toContain('23');
    expect(html).toContain('21M');
    expect(html).toContain('tarskia/harbor');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('aria-sort="none"');
  });

  it('filters by repository label, title, slug, and fallback path', () => {
    const rows = buildRows();

    expect(filterPublicGalleryRows(rows, 'outline')).toHaveLength(1);
    expect(filterPublicGalleryRows(rows, 'coolify')).toHaveLength(1);
    expect(filterPublicGalleryRows(rows, 'harbor')).toHaveLength(1);
    expect(filterPublicGalleryRows(rows, 'tarskia/harbor')).toHaveLength(1);
  });

  it('sorts rows by repository, nodes, and tokens with missing values last', () => {
    const rows = buildRows();

    const sortAndRead = (sortKey: SortKey, sortDirection: SortDirection) =>
      sortPublicGalleryRows(rows, { sortKey, sortDirection }).map((row) => row.slug);

    expect(sortAndRead('repository', 'asc')).toEqual(['coolify', 'outline', 'harbor']);
    expect(sortAndRead('nodes', 'desc')).toEqual(['outline', 'coolify', 'harbor']);
    expect(sortAndRead('nodes', 'asc')).toEqual(['outline', 'coolify', 'harbor']);
    expect(sortAndRead('tokens', 'desc')).toEqual(['outline', 'coolify', 'harbor']);
    expect(sortAndRead('tokens', 'asc')).toEqual(['coolify', 'outline', 'harbor']);
  });

  it('coerces direct and nested gallery list payloads', () => {
    const rows = buildRows();

    expect(coerceGallerySummaryArray(rows)).toHaveLength(3);
    expect(coerceGallerySummaryArray({ data: rows })).toHaveLength(3);
    expect(coerceGallerySummaryArray({ diagrams: rows })).toEqual([]);
    expect(coerceSuccessfulResponseBody({ status: 200, data: rows })).toBe(rows);
    expect(coerceSuccessfulResponseBody({ status: 500, data: rows })).toBeUndefined();
    expect(coerceSuccessfulResponseBody(rows)).toBe(rows);
  });
});
