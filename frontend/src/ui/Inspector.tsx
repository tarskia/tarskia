import { ChevronDown, ChevronRight, Copy, Focus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import type {
  InspectorPropertyFieldView,
  InspectorProvenanceView,
  InspectorViewModel,
} from '../shell/view-models';

interface InspectorProps {
  viewModel: InspectorViewModel;
  onUpdateName: (id: string, name: string) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
  onCreateChild: (parentId: string, typeId: string, name?: string) => void;
  onCreateSibling: (siblingId: string, typeId: string, name?: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, parentId?: string) => void;
  onSetProp: (id: string, key: string, value: unknown) => void;
  onDeleteProp: (id: string, key: string) => void;
  onDelete: (id: string) => void;
  onFocusView?: (id: string) => void;
  initialTagEditMode?: boolean;
}

export type TagOption = { id: string; label: string };

const _titleCase = (value: string) =>
  value.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());

export const normalizeTagIds = (tags?: string[]) =>
  Array.from(new Set((tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0)));

export const buildTagOptions = (tags?: Array<{ id: string; label: string }>): TagOption[] =>
  Array.from(
    new Map((tags ?? []).map((tag) => [tag.id, { id: tag.id, label: tag.label }])).values(),
  );

export const resolveTagInputToId = (raw: string, options: TagOption[]) => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const byLabel = new Map(
    options
      .map((tag) => [tag.label.trim().toLowerCase(), tag.id] as const)
      .filter(([label]) => label.length > 0),
  );
  const matchLabel = byLabel.get(trimmed.toLowerCase());
  if (matchLabel) return matchLabel;
  const matchById = options.find((tag) => tag.id.toLowerCase() === trimmed.toLowerCase());
  if (matchById) return matchById.id;
  return trimmed;
};

const _serializePropValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const parsePropValue = (raw: string, field?: InspectorPropertyFieldView): unknown => {
  if (field?.type === 'enum') return raw;
  if (field?.type === 'boolean') return raw === 'true';
  if (field?.type === 'number') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
};

function ProvenancePanel({ provenance }: { provenance?: InspectorProvenanceView }) {
  if (!provenance || provenance.locations.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {typeof provenance.confidence === 'number' && Number.isFinite(provenance.confidence) && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-muted-foreground">
            Confidence: <span className="font-medium text-foreground">{provenance.confidence}</span>
          </span>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {provenance.locations.map((location, index) => (
          <div
            key={`${location.path}:${location.symbol ?? index}`}
            className="flex flex-col gap-0.5"
          >
            {location.permalink ? (
              <a
                href={location.permalink}
                target="_blank"
                rel="noreferrer"
                className="text-[15px] font-medium leading-snug break-all text-accent hover:underline"
                title={location.permalink}
              >
                {location.path}
              </a>
            ) : (
              <div className="text-[15px] font-medium leading-snug break-all">{location.path}</div>
            )}
            {location.symbol && (
              <div className="text-xs text-muted-foreground">Symbol: {location.symbol}</div>
            )}
            {location.note && <div className="text-xs text-muted-foreground">{location.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  defaultOpen = false,
  children,
  count,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border">
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start gap-1.5 px-0 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setOpen((previous) => !previous)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
        {count !== undefined && (
          <span className="ml-auto text-[11px] font-normal tabular-nums opacity-60">{count}</span>
        )}
      </Button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

function QuickCreateBtn({
  label,
  typeOptions,
  nameValue,
  onNameChange,
  typeValue,
  onTypeChange,
  onCreate,
  inputClass,
  selectClass,
}: {
  label: string;
  typeOptions: Array<{ id: string; label: string }>;
  nameValue: string;
  onNameChange: (value: string) => void;
  typeValue: string;
  onTypeChange: (value: string) => void;
  onCreate: (typeId: string, name?: string) => void;
  inputClass: string;
  selectClass: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="accent" size="sm" onClick={() => setOpen(true)} title={label}>
        <Plus size={13} />
        {label}
      </Button>
    );
  }

  const effectiveType = typeValue || typeOptions[0]?.id || '';

  return (
    <div className="w-full flex flex-col gap-1.5 py-1.5 px-1 rounded-md border border-accent/20 bg-accent/5">
      <div className="flex items-center gap-1">
        {typeOptions.length === 1 ? (
          <span className="flex-1 text-xs font-medium text-foreground/80 px-1 truncate">
            {typeOptions[0].label}
          </span>
        ) : (
          <Select
            className={`flex-1 ${selectClass} text-xs py-1`}
            value={effectiveType}
            onChange={(event) => onTypeChange(event.target.value)}
          >
            {typeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Input
          className={`flex-1 ${inputClass} text-xs py-1`}
          placeholder="Name (optional)"
          value={nameValue}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onCreate(effectiveType, nameValue || undefined);
              onNameChange('');
            }
            if (event.key === 'Escape') setOpen(false);
          }}
          // biome-ignore lint/a11y/noAutofocus: Quick-create inline form should focus immediately.
          autoFocus
        />
        <Button
          size="sm"
          disabled={!effectiveType}
          onClick={() => {
            onCreate(effectiveType, nameValue || undefined);
            onNameChange('');
          }}
        >
          <Plus size={11} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
          <X size={12} />
        </Button>
      </div>
    </div>
  );
}

export function Inspector({
  viewModel,
  onUpdateName,
  onUpdateTags,
  onCreateChild,
  onCreateSibling,
  onDuplicate,
  onMove,
  onSetProp,
  onDeleteProp,
  onDelete,
  onFocusView,
  initialTagEditMode,
}: InspectorProps) {
  const entityView = viewModel.kind === 'entity' ? viewModel : undefined;
  const relationView = viewModel.kind === 'relation' ? viewModel : undefined;
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(Boolean(initialTagEditMode));
  const [nameDraft, setNameDraft] = useState('');
  const [tagDrafts, setTagDrafts] = useState<string[]>([]);
  const [newTagDraft, setNewTagDraft] = useState('');
  const [childTypeId, setChildTypeId] = useState('');
  const [childName, setChildName] = useState('');
  const [siblingTypeId, setSiblingTypeId] = useState('');
  const [siblingName, setSiblingName] = useState('');
  const [moveParentId, setMoveParentId] = useState(
    viewModel.kind === 'entity' ? (viewModel.currentParentId ?? '') : '',
  );
  const [newPropKey, setNewPropKey] = useState('');
  const [newPropValue, setNewPropValue] = useState('');
  const [propDrafts, setPropDrafts] = useState<Record<string, string>>({});
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const schemaFieldByPath = useMemo(
    () => new Map(entityView?.propertyFields.map((field) => [field.path, field]) ?? []),
    [entityView?.propertyFields],
  );
  const availableTagOptions = useMemo(
    () => buildTagOptions(entityView?.availableTagOptions),
    [entityView?.availableTagOptions],
  );

  useEffect(() => {
    if (!entityView) return;
    setPropDrafts(
      Object.fromEntries(entityView.propertyEntries.map((entry) => [entry.path, entry.value])),
    );
    setIsEditingName(false);
    setIsEditingTags(Boolean(initialTagEditMode));
    setNameDraft(entityView.name ?? '');
    setTagDrafts(normalizeTagIds(entityView.explicitTagIds));
    setNewTagDraft('');
    setChildName('');
    setSiblingName('');
    setNewPropKey('');
    setNewPropValue('');
  }, [entityView, initialTagEditMode]);

  useEffect(() => {
    const field = schemaFieldByPath.get(newPropKey.trim());
    if (!field) return;
    if (field.type === 'enum' && field.values && field.values.length > 0 && !newPropValue.trim()) {
      setNewPropValue(field.values[0] ?? '');
      return;
    }
    if (field.type === 'boolean' && newPropValue !== 'true' && newPropValue !== 'false') {
      setNewPropValue('false');
    }
  }, [newPropKey, newPropValue, schemaFieldByPath]);

  useEffect(() => {
    if (!entityView) return;
    if (entityView.childTypeOptions.length === 0) {
      setChildTypeId('');
      return;
    }
    if (!entityView.childTypeOptions.some((option) => option.id === childTypeId)) {
      setChildTypeId(entityView.childTypeOptions[0]?.id ?? '');
    }
  }, [childTypeId, entityView]);

  useEffect(() => {
    if (!entityView) return;
    if (entityView.siblingTypeOptions.length === 0) {
      setSiblingTypeId('');
      return;
    }
    if (!entityView.siblingTypeOptions.some((option) => option.id === siblingTypeId)) {
      setSiblingTypeId(entityView.siblingTypeOptions[0]?.id ?? '');
    }
  }, [entityView, siblingTypeId]);

  useEffect(() => {
    setMoveParentId(entityView?.currentParentId ?? '');
  }, [entityView?.currentParentId]);

  const inputClass =
    'w-full bg-background/60 border border-border rounded-md px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 transition-colors';
  const selectClass =
    'w-full bg-background/60 border border-border rounded-md px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-ring';

  if (!entityView) {
    if (!relationView) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground px-6">
          <div className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center">
            <Focus size={18} className="opacity-40" />
          </div>
          <div className="text-sm text-center">
            Select a node or edge to inspect its properties.
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Relation
          </div>
          <div className="text-base font-bold">{relationView.relationLabel}</div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-10 shrink-0">From</span>
              <span className="px-2.5 py-1 rounded-md bg-muted/40 text-sm font-medium">
                {relationView.sourceLabel}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-10 shrink-0">To</span>
              <span className="px-2.5 py-1 rounded-md bg-muted/40 text-sm font-medium">
                {relationView.targetLabel}
              </span>
            </div>
          </div>
          {relationView.displayedTags.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {relationView.displayedTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-2 py-0.5 rounded-full border border-border bg-muted/30 text-xs"
                    style={tag.color ? { color: tag.color } : undefined}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {relationView.description && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Description</span>
              <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-sm leading-relaxed text-foreground/88 whitespace-pre-wrap">
                {relationView.description}
              </div>
            </div>
          )}
          {relationView.provenance && relationView.provenance.locations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Provenance</span>
              <ProvenancePanel provenance={relationView.provenance} />
            </div>
          )}
          {relationView.propertyEntries.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Properties</span>
              <div className="flex flex-col gap-1.5">
                {relationView.propertyEntries.map((entry) => (
                  <div
                    key={entry.path}
                    className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 px-2.5 py-2"
                  >
                    <span className="text-xs text-muted-foreground">{entry.label}</span>
                    <span className="max-w-[65%] break-words text-right text-sm font-medium">
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const addTagDraft = () => {
    const next = resolveTagInputToId(newTagDraft, availableTagOptions);
    if (!next) return;
    setTagDrafts((previous) => (previous.includes(next) ? previous : [...previous, next]));
    setNewTagDraft('');
  };

  const hasTagChanges =
    normalizeTagIds(tagDrafts).join('\n') !== normalizeTagIds(entityView.explicitTagIds).join('\n');

  const commitPropValue = (key: string, raw: string) =>
    onSetProp(entityView.entityId, key, parsePropValue(raw, schemaFieldByPath.get(key)));
  const hasPendingParentChange = moveParentId !== (entityView.currentParentId ?? '');
  const entityTypeStyle =
    entityView.typeHue === undefined
      ? undefined
      : { color: `hsla(${entityView.typeHue}, 48%, 58%, 0.96)` };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <span
          className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] leading-none text-muted-foreground"
          style={entityTypeStyle}
          title={entityView.typeLabel}
        >
          {entityView.typeLabel}
        </span>

        <div className="mt-1.5">
          {isEditingName ? (
            <div className="flex items-center gap-1.5">
              <Input
                ref={nameInputRef}
                className={`flex-1 ${inputClass} text-base font-bold`}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onUpdateName(entityView.entityId, nameDraft);
                    setIsEditingName(false);
                  }
                  if (event.key === 'Escape') {
                    setNameDraft(entityView.name ?? '');
                    setIsEditingName(false);
                  }
                }}
                onBlur={() => {
                  onUpdateName(entityView.entityId, nameDraft);
                  setIsEditingName(false);
                }}
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="group h-auto w-full justify-start gap-2 px-0 py-0 text-left hover:bg-transparent"
              onClick={() => {
                setNameDraft(entityView.name ?? '');
                setIsEditingName(true);
              }}
              title="Click to rename"
            >
              <h3 className="text-base font-bold truncate flex-1">{entityView.displayName}</h3>
              <Pencil
                size={12}
                className="opacity-0 group-hover:opacity-50 transition-opacity shrink-0"
              />
            </Button>
          )}
        </div>
        <div className="mt-2.5">
          {isEditingTags ? (
            <div className="flex flex-col gap-2">
              {entityView.derivedTagLabels.length > 0 && (
                <div className="text-[11px] text-muted-foreground italic">
                  Derived from schema: {entityView.derivedTagLabels.join(', ')}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {tagDrafts.map((tagId) => {
                  const option = availableTagOptions.find((candidate) => candidate.id === tagId);
                  return (
                    <Button
                      key={tagId}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs hover:bg-accent/20 hover:text-foreground"
                      onClick={() =>
                        setTagDrafts((previous) =>
                          previous.filter((candidate) => candidate !== tagId),
                        )
                      }
                    >
                      {option?.label ?? tagId}
                      <X size={10} />
                    </Button>
                  );
                })}
                {tagDrafts.length === 0 && (
                  <span className="text-xs text-muted-foreground">No explicit tags</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  className={`flex-1 ${inputClass} text-xs`}
                  placeholder="add tag"
                  list={`tag-options-${entityView.entityId}`}
                  value={newTagDraft}
                  onChange={(event) => setNewTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTagDraft();
                    }
                  }}
                />
                <Button variant="ghost" size="sm" onClick={addTagDraft}>
                  Add
                </Button>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={!hasTagChanges}
                  onClick={() => {
                    onUpdateTags(entityView.entityId, tagDrafts);
                    setIsEditingTags(false);
                  }}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTagDrafts(entityView.explicitTagIds);
                    setNewTagDraft('');
                    setIsEditingTags(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
              <datalist id={`tag-options-${entityView.entityId}`}>
                {availableTagOptions.map((tag) => (
                  <option key={tag.id} value={tag.label} />
                ))}
              </datalist>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {entityView.displayedTags.length > 0 ? (
                entityView.displayedTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-2 py-0.5 rounded-full border border-border bg-muted/30 text-[11px]"
                    style={tag.color ? { color: tag.color } : undefined}
                  >
                    {tag.label}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-muted-foreground">No tags</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-1"
                onClick={() => {
                  setTagDrafts(entityView.explicitTagIds);
                  setNewTagDraft('');
                  setIsEditingTags(true);
                }}
              >
                Edit tags
              </Button>
            </div>
          )}
        </div>
        {entityView.provenance && entityView.provenance.locations.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Provenance</span>
            <ProvenancePanel provenance={entityView.provenance} />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4">
        {entityView.description && (
          <Section title="Description" defaultOpen>
            <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2 text-sm leading-relaxed text-foreground/88 whitespace-pre-wrap">
              {entityView.description}
            </div>
          </Section>
        )}
        {/* Primary actions */}
        <div className="border-b border-border py-2">
          <div className="flex items-center gap-0.5 flex-wrap">
            {entityView.childTypeOptions.length > 0 && (
              <QuickCreateBtn
                label="Add child"
                typeOptions={entityView.childTypeOptions}
                nameValue={childName}
                onNameChange={setChildName}
                typeValue={childTypeId}
                onTypeChange={setChildTypeId}
                onCreate={(typeId, name) => onCreateChild(entityView.entityId, typeId, name)}
                inputClass={inputClass}
                selectClass={selectClass}
              />
            )}
            {entityView.siblingTypeOptions.length > 0 && (
              <QuickCreateBtn
                label="Add sibling"
                typeOptions={entityView.siblingTypeOptions}
                nameValue={siblingName}
                onNameChange={setSiblingName}
                typeValue={siblingTypeId}
                onTypeChange={setSiblingTypeId}
                onCreate={(typeId, name) => onCreateSibling(entityView.entityId, typeId, name)}
                inputClass={inputClass}
                selectClass={selectClass}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              title="Duplicate"
              onClick={() => onDuplicate(entityView.entityId)}
            >
              <Copy size={13} />
              Duplicate
            </Button>
            <div className="flex-1" />
            <Button
              variant="destructive"
              size="sm"
              title="Delete"
              onClick={() => onDelete(entityView.entityId)}
            >
              <Trash2 size={13} />
              Delete
            </Button>
          </div>
          {entityView.moveParentOptions.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Parent
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Current: {entityView.currentParentLabel}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  className="min-w-0 flex-1 bg-background/60 text-xs"
                  value={moveParentId}
                  onChange={(event) => setMoveParentId(event.target.value)}
                  aria-label="Select new parent"
                >
                  {entityView.moveParentOptions.map((option) => (
                    <option key={option.id || 'root'} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  title={
                    hasPendingParentChange ? 'Change parent' : 'Select a different parent first'
                  }
                  disabled={!hasPendingParentChange}
                  onClick={() => onMove(entityView.entityId, moveParentId || undefined)}
                >
                  Change parent
                </Button>
              </div>
            </div>
          )}
        </div>

        <Section title="Properties" defaultOpen count={entityView.propertyEntries.length}>
          <div className="flex flex-col gap-2">
            {entityView.propertyEntries.length === 0 && (
              <div className="text-xs text-muted-foreground">No properties set.</div>
            )}
            {entityView.propertyEntries.map((entry) => {
              const field = schemaFieldByPath.get(entry.path);
              const serialized = entry.value;
              const draft = propDrafts[entry.path] ?? serialized;
              const isDirty = draft !== serialized;
              const enumValues = field?.type === 'enum' ? (field.values ?? []) : [];
              const canUseStrictEnum =
                field?.type === 'enum' && enumValues.length > 0 && !field.allowOther;
              const isBooleanField = field?.type === 'boolean';
              return (
                <div key={entry.path} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[11px] text-muted-foreground font-medium"
                      title={entry.path}
                    >
                      {entry.label}
                    </span>
                    <div className="flex gap-0.5">
                      {isDirty && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-accent"
                            onClick={() => commitPropValue(entry.path, draft)}
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPropDrafts((previous) => ({
                                ...previous,
                                [entry.path]: serialized,
                              }))
                            }
                          >
                            Reset
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive/70 hover:text-destructive"
                        onClick={() => onDeleteProp(entityView.entityId, entry.path)}
                      >
                        <X size={11} />
                      </Button>
                    </div>
                  </div>
                  {canUseStrictEnum ? (
                    <Select
                      className={selectClass}
                      value={draft}
                      onChange={(event) =>
                        setPropDrafts((previous) => ({
                          ...previous,
                          [entry.path]: event.target.value,
                        }))
                      }
                    >
                      {!enumValues.includes(draft) && draft ? (
                        <option value={draft}>{draft}</option>
                      ) : null}
                      {enumValues.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  ) : isBooleanField ? (
                    <Select
                      className={selectClass}
                      value={draft === 'true' ? 'true' : 'false'}
                      onChange={(event) =>
                        setPropDrafts((previous) => ({
                          ...previous,
                          [entry.path]: event.target.value,
                        }))
                      }
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </Select>
                  ) : (
                    <Input
                      className={inputClass}
                      value={draft}
                      list={
                        field?.type === 'enum' && enumValues.length > 0
                          ? `enum-${entityView.entityId}-${entry.path.replace(/[^a-z0-9]+/gi, '-')}`
                          : undefined
                      }
                      onChange={(event) =>
                        setPropDrafts((previous) => ({
                          ...previous,
                          [entry.path]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter')
                          commitPropValue(entry.path, event.currentTarget.value);
                        if (event.key === 'Escape') {
                          setPropDrafts((previous) => ({ ...previous, [entry.path]: serialized }));
                        }
                      }}
                    />
                  )}
                  {field?.type === 'enum' && enumValues.length > 0 ? (
                    <datalist
                      id={`enum-${entityView.entityId}-${entry.path.replace(/[^a-z0-9]+/gi, '-')}`}
                    >
                      {enumValues.map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                  ) : null}
                </div>
              );
            })}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border/50">
              <div className="text-[11px] text-muted-foreground font-medium">Add property</div>
              <Input
                className={`${inputClass} text-xs`}
                placeholder="Key"
                list={`prop-keys-${entityView.entityId}`}
                value={newPropKey}
                onChange={(event) => setNewPropKey(event.target.value)}
              />
              {(() => {
                const field = schemaFieldByPath.get(newPropKey.trim());
                const enumValues = field?.type === 'enum' ? (field.values ?? []) : [];
                if (field?.type === 'enum' && enumValues.length > 0 && !field.allowOther) {
                  return (
                    <Select
                      className={selectClass}
                      value={newPropValue}
                      onChange={(event) => setNewPropValue(event.target.value)}
                    >
                      {enumValues.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  );
                }
                if (field?.type === 'boolean') {
                  return (
                    <Select
                      className={selectClass}
                      value={newPropValue === 'true' ? 'true' : 'false'}
                      onChange={(event) => setNewPropValue(event.target.value)}
                    >
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </Select>
                  );
                }
                return (
                  <Input
                    className={`${inputClass} text-xs`}
                    placeholder="Value"
                    list={
                      field?.type === 'enum' && enumValues.length > 0
                        ? `new-enum-${entityView.entityId}`
                        : undefined
                    }
                    value={newPropValue}
                    onChange={(event) => setNewPropValue(event.target.value)}
                  />
                );
              })()}
              <Button
                size="sm"
                className="self-start"
                disabled={newPropKey.trim().length === 0}
                onClick={() => {
                  const key = newPropKey.trim();
                  if (!key) return;
                  onSetProp(
                    entityView.entityId,
                    key,
                    parsePropValue(newPropValue, schemaFieldByPath.get(key)),
                  );
                  setNewPropKey('');
                  setNewPropValue('');
                }}
              >
                <Plus size={11} /> Add
              </Button>
              <datalist id={`prop-keys-${entityView.entityId}`}>
                {entityView.propertyFields.map((field) => (
                  <option key={field.path} value={field.path}>
                    {field.label}
                  </option>
                ))}
              </datalist>
              <datalist id={`new-enum-${entityView.entityId}`}>
                {(schemaFieldByPath.get(newPropKey.trim())?.values ?? []).map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
