import {
  ChevronDown,
  Download,
  Import,
  Plus,
  Save,
  Table2,
  TerminalSquare,
} from 'lucide-react';
import Handsontable from 'handsontable/base';
import { registerAllModules } from 'handsontable/registry';
import { HotTable, type HotTableRef } from '@handsontable/react-wrapper';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'handsontable/styles/handsontable.min.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addSheetField, createSheetForm, hideSheetField, insertRows, listRows, listSheetFields, listSheetForms, listSheetViews, renameSheetForm, SheetField, SheetForm, tightenSheetFieldType, updateRow, updateSheetViewColumnOrder, updateSheetViewWidths } from './api';
import { headersFromStencilYaml } from './stencil';

registerAllModules();

type FieldType = 'text' | 'url' | 'link' | 'score' | 'number' | 'status' | 'integer' | 'numeric' | 'boolean' | 'date' | 'timestamptz';

interface Column {
  key: string;
  fieldId?: string;
  label: string;
  type: FieldType;
  width: number;
}

interface Row {
  id: string;
  values: Record<string, string>;
}

const initialColumns: Column[] = [
  { key: 'company', label: 'Company', type: 'text', width: 260 },
  { key: 'domain', label: 'Domain', type: 'url', width: 190 },
  { key: 'source', label: 'Source records', type: 'link', width: 280 },
  { key: 'fit', label: 'Schema fit', type: 'score', width: 150 },
  { key: 'records', label: 'Rows', type: 'number', width: 140 },
  { key: 'api', label: 'API status', type: 'status', width: 160 },
];

const initialRows: Row[] = [
  row('vercel', ['Vercel', 'vercel.com', 'Website leads, Enterprise', 'Excellent', '1,248', 'Live']),
  row('digitalocean', ['DigitalOcean', 'digitalocean.com', 'Cloud accounts', 'Medium', '904', 'Live']),
  row('github', ['GitHub', 'github.com', 'Developer tools, Open source', 'Good', '2,010', 'Live']),
  row('stripe', ['Stripe', 'stripe.com', 'Payments', 'Good', '1,620', 'Live']),
  row('figma', ['Figma', 'figma.com', 'Design ops', 'Good', '812', 'Draft']),
  row('intercom', ['Intercom', 'intercom.com', 'Support, Expansion', 'Medium', '694', 'Live']),
  row('segment', ['Segment', 'segment.com', 'Warehouse sync', 'Good', '550', 'Live']),
  row('notion', ['Notion', 'notion.so', 'Workspace import', 'Medium', '438', 'Draft']),
  row('slack', ['Slack', 'slack.com', 'Team directory', 'Low', '315', 'Paused']),
  emptyRow('draft-1', initialColumns),
];

const dbFieldTypes = ['text', 'integer', 'numeric', 'boolean', 'date', 'timestamptz'] as const;

function row(id: string, values: string[]): Row {
  return {
    id,
    values: Object.fromEntries(initialColumns.map((column, index) => [column.key, values[index] ?? ''])),
  };
}

function emptyRow(id: string, columns: Column[]): Row {
  return {
    id,
    values: Object.fromEntries(columns.map((column) => [column.key, ''])),
  };
}

function newColumn(index: number): Column {
  return {
    key: `field_${index + 1}`,
    label: '',
    type: 'text',
    width: 180,
  };
}

function columnsFromHeaders(headers: string[]): Column[] {
  return headers.map((header, index) => ({
    key: `field_${index + 1}`,
    label: header,
    type: 'text',
    width: Math.max(160, Math.min(280, header.length * 12 + 96)),
  }));
}

function blankDraft() {
  const columns = [newColumn(0), newColumn(1), newColumn(2)];
  return { columns, rows: [emptyRow('draft-1', columns)] };
}

export function App({ onSignOut }: { onSignOut?: () => void }) {
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const [sheetForm, setSheetForm] = useState<SheetForm | null>(null);
  const [sheetForms, setSheetForms] = useState<SheetForm[]>([]);
  const [formName, setFormName] = useState('Companies');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('Local draft');
  const [apiVisible, setApiVisible] = useState(false);
  const hotRef = useRef<HotTableRef>(null);
  const apiSummaryRef = useRef<HTMLElement>(null);
  const stencilInputRef = useRef<HTMLInputElement>(null);
  const draftStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestForm() {
      try {
        const forms = await listSheetForms();
        if (draftStartedRef.current) return;
        if (!cancelled) setSheetForms(forms);
        const [form] = forms;
        if (!form && !cancelled) {
          const draft = blankDraft();
          setSheetForm(null);
          setFormName('Untitled Sheet Form');
          setColumns(draft.columns);
          setRows(draft.rows);
          setSaveState('idle');
          setSaveMessage('No Sheet Forms yet');
        }
        if (!form || cancelled) return;
        await loadForm(form, () => cancelled || draftStartedRef.current);
      } catch {
        // Keep the local draft usable when the API is not up yet.
      }
    }

    void loadLatestForm();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadForm = async (form: SheetForm, isCancelled: () => boolean = () => false) => {
    draftStartedRef.current = false;
    try {
      const fields = await listSheetFields(form.id);
      const views = await listSheetViews(form.id);
      const visibleFields = fields.filter((field) => !field.hidden);
      const loadedColumns = columnsFromFields(visibleFields, views[0]?.column_widths ?? {}, views[0]?.sort_filter_state?.column_order ?? []);
      const loadedRows = rowsFromRecords(
        await listRows<Record<string, string | null>>(form.generated_table_name),
        loadedColumns,
        visibleFields,
      );

      if (isCancelled()) return;
      const nextColumns = loadedColumns.length > 0 ? loadedColumns : [newColumn(0)];
      setSheetForm(form);
      setFormName(form.name);
      setColumns(nextColumns);
      setRows(ensureBlankRow(loadedRows, nextColumns));
      setApiVisible(false);
      setSaveState('saved');
      setSaveMessage('Loaded from database');
    } catch (error) {
      if (isCancelled()) return;
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Load failed');
    }
  };

  const hotData = useMemo(
    () => [
      columns.map((column) => column.label),
      ...rows.map((currentRow) => columns.map((column) => currentRow.values[column.key] ?? '')),
    ],
    [columns, rows],
  );

  const ensureNextRow = (nextRows: Row[]) => {
    const last = nextRows.at(-1);
    if (!last || Object.values(last.values).some((value) => value.trim() !== '')) {
      return [...nextRows, emptyRow(`draft-${nextRows.length + 1}`, columns)];
    }
    return nextRows;
  };

  const updateHeader = (columnIndex: number, label: string) => {
    setColumns((currentColumns) => currentColumns.map((column, index) => (
      index === columnIndex ? { ...column, label } : column
    )));
  };

  const updateCell = (rowIndex: number, columnKey: string, value: string) => {
    setRows((currentRows) => {
      const nextRows = [...currentRows];
      while (nextRows.length <= rowIndex) {
        nextRows.push(emptyRow(`draft-${nextRows.length + 1}`, columns));
      }
      nextRows[rowIndex] = {
        ...nextRows[rowIndex],
        values: { ...nextRows[rowIndex].values, [columnKey]: value },
      };
      return ensureNextRow(nextRows);
    });
  };

  const addColumn = () => {
    setColumns((currentColumns) => {
      const column = newColumn(currentColumns.length);
      setRows((currentRows) => currentRows.map((currentRow) => ({
        ...currentRow,
        values: { ...currentRow.values, [column.key]: '' },
      })));
      requestAnimationFrame(() => hotRef.current?.hotInstance?.selectCell(0, currentColumns.length));
      return [...currentColumns, column];
    });
  };

  const resizeColumn = async (columnIndex: number, delta: number) => {
    const column = columns[columnIndex];
    if (!column) return;
    const width = Math.max(120, Math.min(420, column.width + delta));
    const nextColumns = columns.map((currentColumn, index) => (
      index === columnIndex ? { ...currentColumn, width } : currentColumn
    ));
    setColumns(nextColumns);
    if (!sheetForm) return;

    try {
      await updateSheetViewWidths(sheetForm.id, Object.fromEntries(nextColumns.map((currentColumn) => [currentColumn.key, currentColumn.width])));
      setSaveState('saved');
      setSaveMessage('Column widths saved');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not save column widths');
    }
  };

  const moveColumn = async (columnIndex: number, delta: number) => {
    const targetIndex = columnIndex + delta;
    if (targetIndex < 0 || targetIndex >= columns.length) return;
    const nextColumns = [...columns];
    const [column] = nextColumns.splice(columnIndex, 1);
    nextColumns.splice(targetIndex, 0, column);
    setColumns(nextColumns);
    if (!sheetForm) return;

    try {
      await updateSheetViewColumnOrder(sheetForm.id, nextColumns.map((currentColumn) => currentColumn.key));
      setSaveState('saved');
      setSaveMessage('Column order saved');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not save column order');
    }
  };

  const hideColumn = async (columnIndex: number) => {
    const column = columns[columnIndex];
    if (!column) return;

    const nextColumns = columns.filter((_, index) => index !== columnIndex);
    const usableColumns = nextColumns.length > 0 ? nextColumns : [newColumn(0)];
    const removeColumnValue = (currentRow: Row): Row => {
      const { [column.key]: _hiddenValue, ...values } = currentRow.values;
      return { ...currentRow, values };
    };

    if (!sheetForm || !column.fieldId) {
      setColumns(usableColumns);
      setRows((currentRows) => currentRows.map(removeColumnValue));
      setSaveState('idle');
      setSaveMessage('Local field removed');
      return;
    }

    setSaveState('saving');
    setSaveMessage('Hiding field');
    try {
      await hideSheetField(sheetForm.id, column.fieldId);
      setColumns(usableColumns);
      setRows((currentRows) => currentRows.map(removeColumnValue));
      setSaveState('saved');
      setSaveMessage('Field hidden');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not hide field');
    }
  };

  const tightenColumnType = async (columnIndex: number, targetType: FieldType) => {
    const column = columns[columnIndex];
    if (!column || column.type === targetType) return;

    if (!sheetForm || !column.fieldId) {
      setColumns((currentColumns) => currentColumns.map((currentColumn, index) => (
        index === columnIndex ? { ...currentColumn, type: targetType } : currentColumn
      )));
      return;
    }

    setSaveState('saving');
    setSaveMessage('Changing field type');
    try {
      const field = await tightenSheetFieldType(sheetForm.id, column.fieldId, targetType);
      setColumns((currentColumns) => currentColumns.map((currentColumn, index) => (
        index === columnIndex ? { ...currentColumn, type: field.type as FieldType } : currentColumn
      )));
      setSaveState('saved');
      setSaveMessage(`Changed ${column.label || 'field'} to ${field.type}`);
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not change field type');
    }
  };

  const saveToAPI = async () => {
    const activeColumns = columns;
    const headers = activeColumns.map((column) => column.label.trim()).filter(Boolean);
    const name = formName.trim();
    if (name === '') {
      setSaveState('error');
      setSaveMessage('Name this Sheet Form');
      return;
    }
    if (headers.length === 0) {
      setSaveState('error');
      setSaveMessage('Add at least one header');
      return;
    }

    setSaveState('saving');
    setSaveMessage('Saving');

    try {
      const existingForm = sheetForm !== null;
      const form = sheetForm
        ? (sheetForm.name === name ? sheetForm : await renameSheetForm(sheetForm.id, name))
        : await createSheetForm(name, headers);
      if (!sheetForm) {
        setSheetForm(form);
        setSheetForms((current) => [form, ...current.filter((existing) => existing.id !== form.id)]);
      } else if (form.name !== sheetForm.name) {
        setSheetForm(form);
        setSheetForms((current) => current.map((existing) => (existing.id === form.id ? form : existing)));
      }
      const loadedFields = await listSheetFields(form.id);
      const fields = existingForm ? await ensureFields(form.id, headers, loadedFields) : loadedFields;
      const changes = rowsToChanges(rows, activeColumns, fields, existingForm);
      for (const change of changes.updates) {
        await updateRow(form.generated_table_name, change.id, change.values);
      }
      if (changes.inserts.length > 0) {
        await insertRows(form.generated_table_name, changes.inserts);
      }
      setSaveState('saved');
      const savedCount = changes.inserts.length + changes.updates.length;
      setSaveMessage(savedCount === 1 ? 'Saved 1 row' : `Saved ${savedCount} rows`);
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Save failed');
    }
  };

  const importStencilConfig = async (file: File | undefined) => {
    if (!file) return;
    try {
      draftStartedRef.current = true;
      const imported = headersFromStencilYaml(await file.text());
      if (imported.headers.length === 0) {
        throw new Error('Stencil config has no fields');
      }
      const nextColumns = columnsFromHeaders(imported.headers);
      setColumns(nextColumns);
      setRows([emptyRow('draft-1', nextColumns)]);
      setSheetForm(null);
      setApiVisible(false);
      setFormName(imported.name || 'Imported Sheet Form');
      setSaveState('idle');
      setSaveMessage(`Imported ${imported.headers.length} headers`);
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Stencil import failed');
    } finally {
      if (stencilInputRef.current) {
        stencilInputRef.current.value = '';
      }
    }
  };

  const createNewForm = () => {
    draftStartedRef.current = true;
    const draft = blankDraft();
    setFormName('Untitled Sheet Form');
    setSheetForm(null);
    setColumns(draft.columns);
    setRows(draft.rows);
    setApiVisible(false);
    setSaveState('idle');
    setSaveMessage('Local draft');
    requestAnimationFrame(() => hotRef.current?.hotInstance?.selectCell(0, 0));
  };

  const showAPIEndpoint = () => {
    if (!sheetForm) {
      setSaveMessage('Save a Sheet Form to create an API endpoint');
      return;
    }
    setSaveMessage(`API URL: ${apiURL(sheetForm.generated_table_name)}`);
    setApiVisible(true);
    apiSummaryRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const handleGridChange = (changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return;
    for (const [rowIndex, prop, previousValue, nextValue] of changes) {
      if (previousValue === nextValue) continue;
      const columnIndex = typeof prop === 'number' ? prop : Number(prop);
      if (!Number.isFinite(columnIndex)) continue;
      const column = columns[columnIndex];
      if (!column) continue;
      if (rowIndex === 0) {
        updateHeader(columnIndex, String(nextValue ?? ''));
      } else {
        updateCell(rowIndex - 1, column.key, String(nextValue ?? ''));
      }
    }
  };

  const persistColumnResize = async (columnIndex: number, width: number) => {
    const nextColumns = columns.map((column, index) => (
      index === columnIndex ? { ...column, width } : column
    ));
    setColumns(nextColumns);
    if (!sheetForm) return;
    try {
      await updateSheetViewWidths(sheetForm.id, Object.fromEntries(nextColumns.map((column) => [column.key, column.width])));
      setSaveState('saved');
      setSaveMessage('Column widths saved');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not save column widths');
    }
  };

  const persistColumnMove = async (movedColumns: number[], finalIndex: number, orderChanged?: boolean) => {
    if (!orderChanged || movedColumns.length === 0) return;
    const nextColumns = [...columns];
    const moved = movedColumns.sort((left, right) => right - left).map((index) => nextColumns.splice(index, 1)[0]).reverse();
    nextColumns.splice(finalIndex, 0, ...moved);
    setColumns(nextColumns);
    if (!sheetForm) return;
    try {
      await updateSheetViewColumnOrder(sheetForm.id, nextColumns.map((column) => column.key));
      setSaveState('saved');
      setSaveMessage('Column order saved');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not save column order');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="workspace-switcher">
          <div className="mark">S</div>
          <div>
            <strong>Sheetbase</strong>
            <span>Local workspace</span>
          </div>
          <ChevronDown size={16} />
        </div>

        <Button className="nav-action" onClick={createNewForm} type="button" variant="ghost" size="sm">
          <Plus data-icon="inline-start" />
          New form
        </Button>

        <div className="nav-section">
          <div className="section-title">
            <ChevronDown size={14} />
            Sheet Forms
          </div>
          <div className="form-list">
            {(sheetForms.length > 0 ? sheetForms : [{ id: 'draft', name: formName } as SheetForm]).map((form) => (
              <a
                className={sheetForm?.id === form.id || (form.id === 'draft' && !sheetForm) ? 'active' : ''}
                href={`#${form.name}`}
                key={form.id}
                onClick={(event) => {
                  event.preventDefault();
                  if (form.id !== 'draft') void loadForm(form);
                }}
              >
                <Table2 size={15} />
                <span>{form.name}</span>
              </a>
            ))}
          </div>
        </div>

        {onSignOut ? (
          <Button className="nav-action sign-out-action" onClick={onSignOut} type="button" variant="ghost" size="sm">
            Sign out
          </Button>
        ) : null}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="title-block">
            <Input
              aria-label="Sheet Form name"
              className="title-input"
              onChange={(event) => setFormName(event.target.value)}
              value={formName}
            />
          </div>
          <div className="view-actions">
            <Button disabled={saveState === 'saving'} onClick={saveToAPI} type="button" size="sm">
              <Save data-icon="inline-start" />
              {saveState === 'saving' ? 'Saving' : 'Save'}
            </Button>
            <Button type="button" aria-label="Add column" onClick={addColumn} variant="outline" size="sm">
              <Plus data-icon="inline-start" />
              Add column
            </Button>
            <Button onClick={showAPIEndpoint} type="button" variant="outline" size="sm">
              <TerminalSquare data-icon="inline-start" />
              API
            </Button>
            <Button onClick={createNewForm} type="button" variant="outline" size="sm">
              <Plus data-icon="inline-start" />
              New form
            </Button>
            <Button onClick={() => stencilInputRef.current?.click()} type="button" variant="outline" size="sm">
              <Import data-icon="inline-start" />
              Import Stencil config
            </Button>
            <input
              ref={stencilInputRef}
              accept=".stencil.yaml,.stencil.yml,.yaml,.yml"
              className="file-input"
              onChange={(event) => void importStencilConfig(event.target.files?.[0])}
              type="file"
            />
            <Button asChild variant="outline" size="sm">
              <a href="/admin/export">
                <Download data-icon="inline-start" />
                Export
              </a>
            </Button>
          </div>
        </header>

        {saveState === 'error' ? (
          <div className="save-error" role="alert">
            {saveMessage}
          </div>
        ) : null}

        {sheetForm && apiVisible ? (
          <section className="api-summary" aria-label="API documentation" ref={apiSummaryRef}>
            <div className="api-doc-header">
              <div>
                <strong>API endpoint</strong>
                <code>{apiURL(sheetForm.generated_table_name)}</code>
              </div>
              <span>PostgREST filters, `select`, `order`, `limit`, and `offset` are supported.</span>
            </div>
            <div className="api-doc-examples">
              <div>
                <strong>Read rows</strong>
                <code>GET /api/{sheetForm.generated_table_name}?select=*&limit=20</code>
              </div>
              <div>
                <strong>Create rows</strong>
                <code>POST /api/{sheetForm.generated_table_name}</code>
              </div>
              <div>
                <strong>Metadata</strong>
                <code>GET /api/sheet_fields?sheet_form_id=eq.{sheetForm.id}&order=position.asc</code>
              </div>
            </div>
            <table className="api-fields">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Column</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((column) => (
                  <tr key={column.key}>
                    <td>{column.label || column.key}</td>
                    <td><code>{column.key}</code></td>
                    <td>{column.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section
          className={`table-frame ${sheetForm && apiVisible ? 'with-api-summary' : ''}`}
          aria-label={`${formName || 'Untitled'} Sheet Form`}
          data-column-widths={columns.map((column) => column.width).join(',')}
        >
          <HotTable
            ref={hotRef}
            data={hotData}
            className="sheetbase-hot"
            rowHeaders
            colHeaders
            colWidths={columns.map((column) => column.width)}
            contextMenu
            manualColumnMove
            manualColumnResize
            minSpareRows={1}
            stretchH="all"
            width="100%"
            height="100%"
            licenseKey="non-commercial-and-evaluation"
            afterChange={handleGridChange}
            afterColumnResize={(newSize: number, columnIndex: number) => {
              if (typeof newSize === 'number') void persistColumnResize(columnIndex, newSize);
            }}
            afterColumnMove={(movedColumns: number[], finalIndex: number, _dropIndex: number | undefined, _movePossible: boolean, orderChanged: boolean) => {
              void persistColumnMove(movedColumns, finalIndex, orderChanged);
            }}
          />
          <div className="grid-a11y-mirror" aria-hidden="false">
            {columns.map((column, columnIndex) => (
              <div key={column.key}>
                <input
                  aria-label={`Header ${columnIndex + 1}`}
                  onChange={(event) => updateHeader(columnIndex, event.target.value)}
                  value={column.label}
                />
                <select
                  aria-label={`Type for ${column.label || `Field ${columnIndex + 1}`}`}
                  onChange={(event) => void tightenColumnType(columnIndex, event.target.value as FieldType)}
                  value={dbFieldTypes.includes(column.type as typeof dbFieldTypes[number]) ? column.type : 'text'}
                >
                  {dbFieldTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <button onClick={() => void moveColumn(columnIndex, -1)} type="button">
                  Move {column.label || `Field ${columnIndex + 1}`} left
                </button>
                <button onClick={() => void moveColumn(columnIndex, 1)} type="button">
                  Move {column.label || `Field ${columnIndex + 1}`} right
                </button>
                <button onClick={() => void resizeColumn(columnIndex, -24)} type="button">
                  Narrow {column.label || `Field ${columnIndex + 1}`}
                </button>
                <button onClick={() => void resizeColumn(columnIndex, 24)} type="button">
                  Widen {column.label || `Field ${columnIndex + 1}`}
                </button>
                <button onClick={() => void hideColumn(columnIndex)} type="button">
                  Hide {column.label || `Field ${columnIndex + 1}`}
                </button>
              </div>
            ))}
            {rows.map((row, rowIndex) => columns.map((column) => (
              <input
                aria-label={`${column.label || 'Untitled field'} value`}
                key={`${row.id}-${column.key}`}
                onChange={(event) => updateCell(rowIndex, column.key, event.target.value)}
                value={row.values[column.key] ?? ''}
              />
            )))}
          </div>
        </section>
      </main>
    </div>
  );
}

function rowsToChanges(rows: Row[], columns: Column[], fields: SheetField[], updateExisting: boolean) {
  const inserts: Record<string, string>[] = [];
  const updates: Array<{ id: string; values: Record<string, string> }> = [];
  for (const currentRow of rows) {
    const values = rowToPayload(currentRow, columns, fields);
    if (Object.keys(values).length === 0) continue;
    if (updateExisting && !currentRow.id.startsWith('draft-')) {
      updates.push({ id: currentRow.id, values });
    } else {
      inserts.push(values);
    }
  }
  return { inserts, updates };
}

function apiURL(tableName: string) {
  return `${window.location.origin}/api/${tableName}`;
}

function rowToPayload(currentRow: Row, columns: Column[], fields: SheetField[]) {
  const fieldsByName = new Map(fields.map((field) => [field.name.trim().toLowerCase(), field]));
  const record: Record<string, string> = {};
  columns.forEach((column) => {
    const header = column.label.trim();
    const value = (currentRow.values[column.key] ?? '').trim();
    const field = fieldsByName.get(header.toLowerCase());
    if (field && value !== '') {
      record[field.column_name] = value;
    }
  });
  return record;
}

async function ensureFields(sheetFormId: string, headers: string[], fields: SheetField[]) {
  const existing = new Set(fields.map((field) => field.name.trim().toLowerCase()));
  const added: SheetField[] = [];
  for (const header of headers) {
    if (!existing.has(header.toLowerCase())) {
      added.push(await addSheetField(sheetFormId, header));
      existing.add(header.toLowerCase());
    }
  }
  return [...fields, ...added].sort((left, right) => left.position - right.position);
}

function columnsFromFields(fields: SheetField[], widths: Record<string, number> = {}, columnOrder: string[] = []): Column[] {
  const columns = fields.map((field) => ({
    key: field.column_name,
    fieldId: field.id,
    label: field.name,
    type: field.type as FieldType,
    width: widths[field.column_name] ?? Math.max(160, Math.min(280, field.name.length * 12 + 96)),
  }));
  if (columnOrder.length === 0) return columns;
  const rank = new Map(columnOrder.map((key, index) => [key, index]));
  return [...columns].sort((left, right) => (rank.get(left.key) ?? columns.length) - (rank.get(right.key) ?? columns.length));
}

function rowsFromRecords(records: Record<string, string | null>[], columns: Column[], fields: SheetField[]): Row[] {
  const fieldsByColumn = new Map(fields.map((field) => [field.column_name, field]));
  return records.map((record, index) => ({
    id: String(record.id ?? `row-${index + 1}`),
    values: Object.fromEntries(columns.map((column) => {
      const field = fieldsByColumn.get(column.key);
      return [column.key, String((field ? record[field.column_name] : '') ?? '')];
    })),
  }));
}

function ensureBlankRow(rows: Row[], columns: Column[]): Row[] {
  const last = rows.at(-1);
  if (!last || Object.values(last.values).some((value) => value.trim() !== '')) {
    return [...rows, emptyRow(`draft-${rows.length + 1}`, columns)];
  }
  return rows;
}
