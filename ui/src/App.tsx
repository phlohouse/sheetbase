import {
  Bell,
  Braces,
  ChevronDown,
  Columns3,
  Database,
  Download,
  Filter,
  Folder,
  Home,
  Import,
  EyeOff,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Table2,
  TerminalSquare,
} from 'lucide-react';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { addSheetField, createSheetForm, hideSheetField, insertRows, listRows, listSheetFields, listSheetForms, renameSheetForm, SheetField, SheetForm, tightenSheetFieldType, updateRow } from './api';
import { headersFromStencilYaml } from './stencil';

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

interface ActiveCell {
  rowIndex: number;
  columnIndex: number;
  kind: 'header' | 'body';
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

const iconByType: Record<FieldType, React.ComponentType<{ size?: number }>> = {
  text: Table2,
  url: Sparkles,
  link: Columns3,
  score: Braces,
  number: Database,
  status: TerminalSquare,
  integer: Database,
  numeric: Database,
  boolean: Braces,
  date: Table2,
  timestamptz: TerminalSquare,
};

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

export function App({ onSignOut }: { onSignOut?: () => void }) {
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const [activeCell, setActiveCell] = useState<ActiveCell>({ rowIndex: 0, columnIndex: 0, kind: 'body' });
  const [sheetForm, setSheetForm] = useState<SheetForm | null>(null);
  const [sheetForms, setSheetForms] = useState<SheetForm[]>([]);
  const [formName, setFormName] = useState('Companies');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('Local draft');
  const gridRef = useRef<HTMLDivElement>(null);
  const stencilInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestForm() {
      try {
        const forms = await listSheetForms();
        if (!cancelled) setSheetForms(forms);
        const [form] = forms;
        if (!form || cancelled) return;
        await loadForm(form, () => cancelled);
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
    try {
      const fields = await listSheetFields(form.id);
      const visibleFields = fields.filter((field) => !field.hidden);
      const loadedColumns = columnsFromFields(visibleFields);
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
      setSaveState('saved');
      setSaveMessage('Loaded from database');
    } catch (error) {
      if (isCancelled()) return;
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Load failed');
    }
  };

  const templateColumns = useMemo(
    () => `44px ${columns.map((column) => `${column.width}px`).join(' ')}`,
    [columns],
  );

  const focusCell = (cell: ActiveCell) => {
    setActiveCell(cell);
    requestAnimationFrame(() => {
      const selector = `[data-cell="${cell.kind}-${cell.rowIndex}-${cell.columnIndex}"]`;
      gridRef.current?.querySelector<HTMLInputElement>(selector)?.focus();
    });
  };

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
    setRows((currentRows) => ensureNextRow(currentRows.map((currentRow, index) => (
      index === rowIndex
        ? { ...currentRow, values: { ...currentRow.values, [columnKey]: value } }
        : currentRow
    ))));
  };

  const addColumn = () => {
    setColumns((currentColumns) => {
      const column = newColumn(currentColumns.length);
      setRows((currentRows) => currentRows.map((currentRow) => ({
        ...currentRow,
        values: { ...currentRow.values, [column.key]: '' },
      })));
      requestAnimationFrame(() => focusCell({ kind: 'header', rowIndex: 0, columnIndex: currentColumns.length }));
      return [...currentColumns, column];
    });
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
    const headers = columns.map((column) => column.label.trim()).filter(Boolean);
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
      const changes = rowsToChanges(rows, columns, fields, existingForm);
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
      const imported = headersFromStencilYaml(await file.text());
      if (imported.headers.length === 0) {
        throw new Error('Stencil config has no fields');
      }
      const nextColumns = columnsFromHeaders(imported.headers);
      setColumns(nextColumns);
      setRows([emptyRow('draft-1', nextColumns)]);
      setSheetForm(null);
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
    const nextColumns = [newColumn(0), newColumn(1), newColumn(2)];
    setFormName('Untitled Sheet Form');
    setSheetForm(null);
    setColumns(nextColumns);
    setRows([emptyRow('draft-1', nextColumns)]);
    setSaveState('idle');
    setSaveMessage('Local draft');
    requestAnimationFrame(() => focusCell({ kind: 'header', rowIndex: 0, columnIndex: 0 }));
  };

  const moveCell = (from: ActiveCell, key: string) => {
    let next: ActiveCell = { ...from };
    if (key === 'ArrowLeft') next.columnIndex = Math.max(0, from.columnIndex - 1);
    if (key === 'ArrowRight' || key === 'Tab') next.columnIndex = Math.min(columns.length - 1, from.columnIndex + 1);
    if (key === 'ArrowUp') {
      if (from.kind === 'body' && from.rowIndex === 0) next = { kind: 'header', rowIndex: 0, columnIndex: from.columnIndex };
      else if (from.kind === 'body') next.rowIndex = Math.max(0, from.rowIndex - 1);
    }
    if (key === 'ArrowDown' || key === 'Enter') {
      next = from.kind === 'header'
        ? { kind: 'body', rowIndex: 0, columnIndex: from.columnIndex }
        : { kind: 'body', rowIndex: Math.min(rows.length - 1, from.rowIndex + 1), columnIndex: from.columnIndex };
    }
    focusCell(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, cell: ActiveCell) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key)) {
      event.preventDefault();
      moveCell(cell, event.key);
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur();
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

        <div className="quick-row">
          <button className="command-button" type="button">
            <Sparkles size={15} />
            Quick actions
            <kbd>⌘K</kbd>
          </button>
          <button className="icon-button" type="button" aria-label="Search">
            <Search size={17} />
          </button>
        </div>

        <nav className="nav-list">
          <a href="#home">
            <Home size={16} />
            Home
          </a>
          <a href="#notifications">
            <Bell size={16} />
            Notifications
          </a>
          <a href="#database">
            <Database size={16} />
            Managed Postgres
          </a>
          <a href="#api">
            <TerminalSquare size={16} />
            API surface
          </a>
        </nav>

        <div className="nav-section">
          <button className="section-title" type="button">
            <ChevronDown size={14} />
            Sheet Forms
          </button>
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

        <div className="nav-section muted-nav">
          <button className="section-title" type="button">
            <ChevronDown size={14} />
            Imports
          </button>
          <a href="#stencil">
            <Folder size={15} />
            Stencil configs
          </a>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="title-block">
            <input
              aria-label="Sheet Form name"
              className="title-input"
              onChange={(event) => setFormName(event.target.value)}
              value={formName}
            />
          </div>
          <div className="topbar-actions">
            <div className="avatars" aria-label="Collaborators">
              <span>G</span>
              <span>A</span>
              <span>J</span>
              <span>+1</span>
            </div>
            <button className="plain-button" onClick={onSignOut} type="button">Sign out</button>
            <button className="ghost-icon" type="button" aria-label="More options">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>

        <section className="view-header" aria-label="Current view">
          <button className="view-pill" type="button">
            <Table2 size={16} />
            Top companies
            <ChevronDown size={14} />
          </button>
          <div className="view-actions">
            <button className="toolbar-button" type="button">
              <Settings size={16} />
              View settings
            </button>
            <button className="toolbar-button primary-action" disabled={saveState === 'saving'} onClick={saveToAPI} type="button">
              <Save size={16} />
              {saveState === 'saving' ? 'Saving' : 'Save'}
            </button>
            <button className="toolbar-button" onClick={createNewForm} type="button">
              <Plus size={16} />
              New form
            </button>
            <button className="toolbar-button" onClick={() => stencilInputRef.current?.click()} type="button">
              <Import size={16} />
              Import Stencil config
            </button>
            <input
              ref={stencilInputRef}
              accept=".stencil.yaml,.stencil.yml,.yaml,.yml"
              className="file-input"
              onChange={(event) => void importStencilConfig(event.target.files?.[0])}
              type="file"
            />
            <button className="toolbar-button" type="button">
              <Download size={16} />
              Export
              <ChevronDown size={14} />
            </button>
          </div>
        </section>

        <section className="filterbar" aria-label="Filters and sorting">
          <button className="filter-chip" type="button">
            <Filter size={15} />
            Sorted by <strong>Updated recently</strong>
          </button>
          <button className="filter-chip" type="button">
            Advanced filter <span>3</span>
          </button>
          <div className={`save-status ${saveState}`} role="status">
            {saveMessage}
          </div>
          <button className="add-filter" onClick={addColumn} type="button" aria-label="Add column">
            <Plus size={17} />
          </button>
        </section>

        <section className="table-frame" aria-label={`${formName || 'Untitled'} Sheet Form`}>
          <div className="data-grid" ref={gridRef} style={{ gridTemplateColumns: templateColumns }}>
            <div className="cell header select-cell">
              <input aria-label="Select all rows" type="checkbox" />
            </div>
            {columns.map((column, columnIndex) => {
              const Icon = iconByType[column.type];
              const isActive = activeCell.kind === 'header' && activeCell.columnIndex === columnIndex;
              return (
                <div className={`cell header column-header ${isActive ? 'active-cell' : ''}`} key={column.key}>
                  <Icon size={15} />
                  <input
                    aria-label={`Header ${columnIndex + 1}`}
                    data-cell={`header-0-${columnIndex}`}
                    onChange={(event) => updateHeader(columnIndex, event.target.value)}
                    onFocus={() => setActiveCell({ kind: 'header', rowIndex: 0, columnIndex })}
                    onKeyDown={(event) => handleKeyDown(event, { kind: 'header', rowIndex: 0, columnIndex })}
                    placeholder={`Field ${columnIndex + 1}`}
                    value={column.label}
                  />
                  {column.fieldId ? (
                    <select
                      aria-label={`Type for ${column.label || `Field ${columnIndex + 1}`}`}
                      className="column-type-select"
                      onChange={(event) => void tightenColumnType(columnIndex, event.target.value as FieldType)}
                      value={dbFieldTypes.includes(column.type as typeof dbFieldTypes[number]) ? column.type : 'text'}
                    >
                      {dbFieldTypes.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  ) : (
                    <em>{column.type}</em>
                  )}
                  <button
                    aria-label={`Hide ${column.label || `Field ${columnIndex + 1}`}`}
                    className="header-action"
                    onClick={() => void hideColumn(columnIndex)}
                    title="Hide field"
                    type="button"
                  >
                    <EyeOff size={14} />
                  </button>
                </div>
              );
            })}

            {rows.map((currentRow, rowIndex) => (
              <RowCells
                activeCell={activeCell}
                columns={columns}
                key={currentRow.id}
                onFocusCell={setActiveCell}
                onKeyDown={handleKeyDown}
                onUpdateCell={updateCell}
                row={currentRow}
                rowIndex={rowIndex}
              />
            ))}
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

function columnsFromFields(fields: SheetField[]): Column[] {
  return fields.map((field) => ({
    key: field.column_name,
    fieldId: field.id,
    label: field.name,
    type: field.type as FieldType,
    width: Math.max(160, Math.min(280, field.name.length * 12 + 96)),
  }));
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

interface RowCellsProps {
  activeCell: ActiveCell;
  columns: Column[];
  onFocusCell: (cell: ActiveCell) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, cell: ActiveCell) => void;
  onUpdateCell: (rowIndex: number, columnKey: string, value: string) => void;
  row: Row;
  rowIndex: number;
}

function RowCells({ activeCell, columns, onFocusCell, onKeyDown, onUpdateCell, row, rowIndex }: RowCellsProps) {
  const rowName = row.values[columns[0]?.key] || `row ${rowIndex + 1}`;

  return (
    <>
      <div className="cell select-cell">
        <input aria-label={`Select ${rowName}`} type="checkbox" />
      </div>
      {columns.map((column, columnIndex) => {
        const value = row.values[column.key] ?? '';
        const isActive = activeCell.kind === 'body'
          && activeCell.rowIndex === rowIndex
          && activeCell.columnIndex === columnIndex;
        return (
          <label className={`cell data-cell ${isActive ? 'active-cell' : ''}`} key={column.key}>
            <CellInput
              cell={{ kind: 'body', rowIndex, columnIndex }}
              column={column}
              onFocusCell={onFocusCell}
              onKeyDown={onKeyDown}
              onUpdate={(nextValue) => onUpdateCell(rowIndex, column.key, nextValue)}
              value={value}
            />
          </label>
        );
      })}
    </>
  );
}

function CellInput({
  cell,
  column,
  onFocusCell,
  onKeyDown,
  onUpdate,
  value,
}: {
  cell: ActiveCell;
  column: Column;
  onFocusCell: (cell: ActiveCell) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, cell: ActiveCell) => void;
  onUpdate: (value: string) => void;
  value: string;
}) {
  const className = column.type === 'text' ? 'plain-cell-input' : `pill-input pill-${pillColor(column, value)}`;

  return (
    <input
      aria-label={`${column.label || 'Untitled field'} value`}
      className={className}
      data-cell={`${cell.kind}-${cell.rowIndex}-${cell.columnIndex}`}
      onChange={(event) => onUpdate(event.target.value)}
      onFocus={() => onFocusCell(cell)}
      onKeyDown={(event) => onKeyDown(event, cell)}
      placeholder="Type…"
      value={value}
    />
  );
}

function pillColor(column: Column, value: string) {
  const normalized = value.toLowerCase();
  if (column.type === 'url' || column.type === 'number') return 'blue';
  if (column.type === 'link') return 'neutral';
  if (normalized === 'excellent') return 'violet';
  if (normalized === 'good' || normalized === 'live') return 'green';
  if (normalized === 'medium' || normalized === 'draft') return 'blue';
  if (normalized === 'low' || normalized === 'paused') return 'amber';
  return 'neutral';
}
