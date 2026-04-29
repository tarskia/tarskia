export type SchemaDraftHighlight = {
  startLine: number;
  endLine: number;
};
export type SummaryMode = 'schema' | 'diagram';

export type SchemaCookbookRecipe = {
  id: string;
  title: string;
  description: string;
  category: string;
  previewText: string;
};

export type SchemaDependencySection = 'tags' | 'traits' | 'types' | 'relations';

export type SchemaDependencyObject = {
  section: SchemaDependencySection;
  id: string;
  label: string;
  selectorPath: string;
  previewText: string;
};

export type SchemaDependency = {
  schemaRef: string;
  schemaLabel: string;
  version: string;
  alias?: string;
  objects: SchemaDependencyObject[];
};

export type SchemaReferenceEntry = {
  key: string;
  summary: string;
  details: string;
  example?: string;
  values?: string[];
};

export type SchemaReferenceSection = {
  id: string;
  title: string;
  description: string;
  entries: SchemaReferenceEntry[];
};

export type SchemaManagerVersion = {
  key: string;
  version: string;
  publishedAtLabel: string;
  summaryLines: string[];
  previewText: string;
  isLatest: boolean;
  isAppliedToDiagram: boolean;
};

export type SchemaManagerStream = {
  schemaRef: string;
  name: string;
  updatedAtLabel: string;
  latestVersion?: string;
  hasDraft: boolean;
  draftBaseVersion?: string;
  draftUpdatedAtLabel?: string;
  isEditing: boolean;
  inUse: boolean;
  deleteDisabled: boolean;
  deleteDisabledReason?: string;
  versions: SchemaManagerVersion[];
};

export type DiagramManagerRevision = {
  id: string;
  versionNumber: number;
  shortId: string;
  checkpointedAtLabel: string;
  summaryLines: string[];
  previewText: string;
  isLatest: boolean;
};

export type DiagramManagerStream = {
  id: string;
  name: string;
  ownerLabel?: string;
  updatedAtLabel: string;
  hasDraft: boolean;
  draftName?: string;
  hasPendingNameChange?: boolean;
  draftBaseRevisionShortId?: string;
  draftUpdatedAtLabel?: string;
  isActive: boolean;
  revisions: DiagramManagerRevision[];
};

export const COOKBOOK_CATEGORY_LABELS: Record<string, string> = {
  define: 'Define',
  adapt: 'Adapt',
  remove: 'Remove',
};

export const DEPENDENCY_SECTION_LABELS: Record<SchemaDependencySection, string> = {
  types: 'Types',
  traits: 'Traits',
  relations: 'Relations',
  tags: 'Tags',
};
