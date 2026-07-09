import {
  Bell,
  Braces,
  ChevronDown,
  Columns3,
  Database,
  Download,
  Filter,
  Folder,
  HelpCircle,
  Home,
  Import,
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
import { createSheetForm, insertRows, listRows, listSheetFields, listSheetForms, SheetField, SheetForm } from './api';
import { headersFromStencilYaml } from './stencil';

type FieldType = 'text' | 'url' | 'link' | 'score' | 'number' | 'status';

interface Column {
  key: string;
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

const forms = [
  { name: 'Companies', count: 12, active: true },
  { name: 'Customers', count: 8 },
  { name: 'Requests', count: 24 },
  { name: 'Deployments', count: 5 },
];

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
};

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

export function App() {
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const [activeCell, setActiveCell] = useState<ActiveCell>({ rowIndex: 0, columnIndex: 0, kind: 'body' });
  const [sheetForm, setSheetForm] = useState<SheetForm | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('Local draft');
  const gridRef = useRef<HTMLDivElement>(null);
  const stencilInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestForm() {
      try {
        const [form] = await listSheetForms();
        if (!form || cancelled) return;

        const fields = await listSheetFields(form.id);
        const visibleFields = fields.filter((field) => !field.hidden);
        const loadedColumns = columnsFromFields(visibleFields);
        const loadedRows = rowsFromRecords(
          await listRows<Record<string, string | null>>(form.generated_table_name),
          loadedColumns,
          visibleFields,
        );

        if (cancelled) return;
        const nextColumns = loadedColumns.length > 0 ? loadedColumns : [newColumn(0)];
        setSheetForm(form);
        setColumns(nextColumns);
        setRows(ensureBlankRow(loadedRows, nextColumns));
        setSaveState('saved');
        setSaveMessage('Loaded from database');
      } catch {
        // Keep the local draft usable when the API is not up yet.
      }
    }

    void loadLatestForm();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const saveToAPI = async () => {
    const headers = columns.map((column) => column.label.trim()).filter(Boolean);
    if (headers.length === 0) {
      setSaveState('error');
      setSaveMessage('Add at least one header');
      return;
    }

    setSaveState('saving');
    setSaveMessage('Saving');

    try {
      const form = sheetForm ?? await createSheetForm('Companies', headers);
      if (!sheetForm) {
        setSheetForm(form);
      }
      const fields = await listSheetFields(form.id);
      const payload = rowsToPayload(rows, columns, fields);
      if (payload.length > 0) {
        await insertRows(form.generated_table_name, payload);
      }
      setSaveState('saved');
      setSaveMessage(payload.length === 1 ? 'Saved 1 row' : `Saved ${payload.length} rows`);
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
            {forms.map((form) => (
              <a className={form.active ? 'active' : ''} href={`#${form.name}`} key={form.name}>
                <Table2 size={15} />
                <span>{form.name}</span>
                <em>{form.count}</em>
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
            <h1>Companies</h1>
            <button className="ghost-icon" type="button" aria-label="Companies info">
              <HelpCircle size={15} />
            </button>
          </div>
          <div className="topbar-actions">
            <div className="avatars" aria-label="Collaborators">
              <span>G</span>
              <span>A</span>
              <span>J</span>
              <span>+1</span>
            </div>
            <button className="plain-button" type="button">Share</button>
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

        <section className="table-frame" aria-label="Companies Sheet Form">
          <div className="data-grid" ref={gridRef} style={{ gridTemplateColumns: templateColumns }}>
            <div className="cell header select-cell">
              <input aria-label="Select all rows" type="checkbox" />
            </div>
            {columns.map((column, columnIndex) => {
              const Icon = iconByType[column.type];
              const isActive = activeCell.kind === 'header' && activeCell.columnIndex === columnIndex;
              return (
                <label className={`cell header column-header ${isActive ? 'active-cell' : ''}`} key={column.key}>
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
                  <em>{column.type}</em>
                </label>
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

function rowsToPayload(rows: Row[], columns: Column[], fields: SheetField[]) {
  const fieldsByName = new Map(fields.map((field) => [field.name.trim().toLowerCase(), field]));
  return rows
    .map((currentRow) => {
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
    })
    .filter((record) => Object.keys(record).length > 0);
}

function columnsFromFields(fields: SheetField[]): Column[] {
  return fields.map((field) => ({
    key: field.column_name,
    label: field.name,
    type: 'text',
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
