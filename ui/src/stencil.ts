import { load } from 'js-yaml';

interface StencilField {
  columns?: Record<string, string>;
  range?: string;
  type?: string;
}

interface StencilVersion {
  fields?: Record<string, StencilField | null>;
}

interface StencilSchema {
  name?: string;
  versions?: Record<string, StencilVersion | null>;
}

export interface StencilHeaders {
  name: string;
  headers: string[];
}

export function headersFromStencilYaml(yaml: string, preferredVersion?: string): StencilHeaders {
  const schema = load(yaml) as StencilSchema | null;
  if (!schema || typeof schema !== 'object') {
    throw new Error('Stencil config is empty');
  }

  const versions = Object.entries(schema.versions ?? {});
  if (versions.length === 0) {
    throw new Error('Stencil config has no versions');
  }

  const [versionName, version] = (
    preferredVersion
      ? versions.find(([name]) => name === preferredVersion)
      : versions.at(-1)
  ) ?? versions[0];

  const fields = Object.entries(version?.fields ?? {});
  const headers = fields.flatMap(([fieldName, field]) => {
    if (field?.type === 'computed') {
      throw new Error(`Unsupported Stencil field ${fieldName}: computed fields cannot become Sheetbase headers`);
    }
    const columnLabels = Object.values(field?.columns ?? {}).filter(isNonEmptyString);
    if (field?.range && columnLabels.length === 0) {
      throw new Error(`Unsupported Stencil field ${fieldName}: ranges need named columns`);
    }
    return columnLabels.length > 0 ? columnLabels : [humanizeFieldName(fieldName)];
  });

  return {
    name: schema.name || versionName || 'Stencil import',
    headers: uniqueHeaders(headers),
  };
}

function uniqueHeaders(headers: string[]) {
  const seen = new Set<string>();
  return headers
    .map((header) => header.trim())
    .filter(Boolean)
    .filter((header) => {
      const key = header.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function humanizeFieldName(name: string) {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
