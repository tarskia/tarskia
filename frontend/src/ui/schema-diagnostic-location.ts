import type { DiagnosticView } from '../shell/view-models';

export interface SchemaDiagnosticLocation {
  path: string;
  displayPath: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

interface ParsedLine {
  index: number;
  text: string;
  trimmed: string;
  indent: number;
  blank: boolean;
  comment: boolean;
  key?: string;
  seqKey?: string;
  seqItem: boolean;
}

type PathToken = string | number;

const KEY_PATTERN = /^([A-Za-z0-9_-]+):(?:\s|$)/;
const SEQ_KEY_PATTERN = /^-\s+([A-Za-z0-9_-]+):(?:\s|$)/;

const extractPathFromMessage = (message: string) => {
  if (!message.startsWith('$')) return undefined;
  const separator = message.indexOf(': ');
  if (separator < 0) return undefined;
  return message.slice(0, separator).trim();
};

export const extractDiagnosticPath = (diagnostic: DiagnosticView): string | undefined =>
  extractPathFromMessage(diagnostic.message) ??
  (diagnostic.path?.startsWith('$') ? diagnostic.path : undefined);

export const formatDiagnosticPath = (path: string) => {
  if (path === '$') return 'root';
  if (path.startsWith('$.')) return path.slice(2);
  if (path.startsWith('$')) return path.slice(1);
  return path;
};

export const formatDiagnosticMessage = (message: string) => {
  const path = extractPathFromMessage(message);
  if (!path) return message;
  return `${formatDiagnosticPath(path)}${message.slice(path.length)}`;
};

const trimToParentPath = (path: string): string | undefined => {
  if (path === '$') return undefined;
  const propertyIndex = path.lastIndexOf('.');
  const listIndex = path.lastIndexOf('[');
  const trimIndex = Math.max(propertyIndex, listIndex);
  if (trimIndex <= 0) return '$';
  return path.slice(0, trimIndex);
};

const parsePath = (path: string): PathToken[] => {
  const tokens: PathToken[] = [];
  let index = 1;
  while (index < path.length) {
    const char = path[index];
    if (char === '.') {
      let cursor = index + 1;
      while (cursor < path.length && path[cursor] !== '.' && path[cursor] !== '[') {
        cursor += 1;
      }
      const token = path.slice(index + 1, cursor).trim();
      if (token) tokens.push(token);
      index = cursor;
      continue;
    }
    if (char === '[') {
      const close = path.indexOf(']', index);
      if (close < 0) break;
      const value = Number(path.slice(index + 1, close));
      if (Number.isInteger(value)) tokens.push(value);
      index = close + 1;
      continue;
    }
    index += 1;
  }
  return tokens;
};

const parseLines = (raw: string): ParsedLine[] =>
  raw.split('\n').map((text, index) => {
    const trimmed = text.trim();
    const indent = text.match(/^ */)?.[0].length ?? 0;
    const seqKeyMatch = SEQ_KEY_PATTERN.exec(trimmed);
    const keyMatch = KEY_PATTERN.exec(trimmed);
    return {
      index,
      text,
      trimmed,
      indent,
      blank: trimmed.length === 0,
      comment: trimmed.startsWith('#'),
      key: keyMatch?.[1],
      seqKey: seqKeyMatch?.[1],
      seqItem: trimmed.startsWith('- '),
    };
  });

const buildLineOffsets = (raw: string) => {
  const offsets = [0];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
};

const findMappingBlockEnd = (lines: ParsedLine[], start: number, end: number, indent: number) => {
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (!line || line.blank || line.comment) continue;
    if (line.indent <= indent) return index;
  }
  return end;
};

const findSequenceItemBlockEnd = (
  lines: ParsedLine[],
  start: number,
  end: number,
  indent: number,
) => {
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (!line || line.blank || line.comment) continue;
    if (line.indent < indent) return index;
    if (line.indent === indent && line.seqItem) return index;
  }
  return end;
};

const findFirstChildIndent = (
  lines: ParsedLine[],
  start: number,
  end: number,
  parentIndent: number,
) => {
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (!line || line.blank || line.comment) continue;
    if (line.indent > parentIndent) return line.indent;
  }
  return undefined;
};

const toLocation = (
  path: string,
  offsets: number[],
  start: number,
  endExclusive: number,
): SchemaDiagnosticLocation => {
  const lastLine = Math.max(start, endExclusive - 1);
  const endOffset =
    lastLine + 1 < offsets.length ? offsets[lastLine + 1] - 1 : offsets[offsets.length - 1];
  return {
    path,
    displayPath: formatDiagnosticPath(path),
    startLine: start + 1,
    endLine: lastLine + 1,
    startOffset: offsets[start] ?? 0,
    endOffset: Math.max(endOffset, offsets[start] ?? 0),
  };
};

const locatePath = (raw: string, path: string): SchemaDiagnosticLocation | undefined => {
  if (!path.startsWith('$')) return undefined;
  const tokens = parsePath(path);
  const lines = parseLines(raw);
  const offsets = buildLineOffsets(raw);
  let rangeStart = 0;
  let rangeEnd = lines.length;
  let mappingIndent = 0;
  let sequenceIndent = 0;
  let currentItem:
    | {
        lineIndex: number;
        indent: number;
      }
    | undefined;
  let lastLocation: SchemaDiagnosticLocation | undefined;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    const next = tokens[tokenIndex + 1];

    if (typeof token === 'string') {
      let foundLine: ParsedLine | undefined;
      let blockEnd = rangeEnd;
      for (let index = rangeStart; index < rangeEnd; index += 1) {
        const line = lines[index];
        if (!line || line.blank || line.comment) continue;
        if (
          currentItem &&
          index === currentItem.lineIndex &&
          line.seqKey === token &&
          currentItem.indent + 2 === mappingIndent
        ) {
          foundLine = line;
          blockEnd = findSequenceItemBlockEnd(lines, index, rangeEnd, currentItem.indent);
          break;
        }
        if (line.indent !== mappingIndent || line.key !== token) continue;
        foundLine = line;
        blockEnd = findMappingBlockEnd(lines, index, rangeEnd, mappingIndent);
        break;
      }
      if (!foundLine) return undefined;
      lastLocation = toLocation(path, offsets, foundLine.index, blockEnd);

      if (typeof next === 'number') {
        rangeStart = foundLine.index + 1;
        rangeEnd = blockEnd;
        sequenceIndent =
          findFirstChildIndent(lines, rangeStart, rangeEnd, foundLine.indent) ??
          foundLine.indent + 2;
        currentItem = undefined;
        continue;
      }

      if (typeof next === 'string') {
        if (foundLine.seqKey === token) {
          rangeStart = foundLine.index;
          rangeEnd = blockEnd;
          currentItem = {
            lineIndex: foundLine.index,
            indent: foundLine.indent,
          };
          mappingIndent = foundLine.indent + 2;
        } else {
          rangeStart = foundLine.index + 1;
          rangeEnd = blockEnd;
          currentItem = undefined;
          mappingIndent =
            findFirstChildIndent(lines, rangeStart, rangeEnd, foundLine.indent) ??
            foundLine.indent + 2;
        }
      }
      continue;
    }

    let seenIndex = -1;
    let foundLine: ParsedLine | undefined;
    let blockEnd = rangeEnd;
    for (let index = rangeStart; index < rangeEnd; index += 1) {
      const line = lines[index];
      if (!line || line.blank || line.comment) continue;
      if (line.indent !== sequenceIndent || !line.seqItem) continue;
      seenIndex += 1;
      if (seenIndex !== token) continue;
      foundLine = line;
      blockEnd = findSequenceItemBlockEnd(lines, index, rangeEnd, sequenceIndent);
      break;
    }
    if (!foundLine) return undefined;
    lastLocation = toLocation(path, offsets, foundLine.index, blockEnd);

    if (typeof next === 'string') {
      rangeStart = foundLine.index;
      rangeEnd = blockEnd;
      currentItem = {
        lineIndex: foundLine.index,
        indent: foundLine.indent,
      };
      mappingIndent = foundLine.indent + 2;
    }
  }

  return lastLocation;
};

export const locateSchemaDiagnostic = (
  raw: string,
  diagnostic: DiagnosticView,
): SchemaDiagnosticLocation | undefined => {
  let currentPath = extractDiagnosticPath(diagnostic);
  while (currentPath) {
    const location = locatePath(raw, currentPath);
    if (location) return location;
    currentPath = trimToParentPath(currentPath);
  }
  return undefined;
};
