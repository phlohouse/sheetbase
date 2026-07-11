import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Cloud,
  Copy,
  Database,
  Download,
  EyeOff,
  Import,
  LoaderCircle,
  Moon,
  Plus,
  Save,
  Sun,
  Table2,
  TerminalSquare,
  X,
} from 'lucide-react';
import Handsontable from 'handsontable/base';
import { registerAllModules } from 'handsontable/registry';
import { HotTable, type HotTableRef } from '@handsontable/react-wrapper';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'handsontable/styles/handsontable.min.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addSheetField, createSheetForm, deleteRow, hideSheetField, insertRows, listRows, listSheetFields, listSheetForms, listSheetViews, renameSheetField, renameSheetForm, setSheetFormSlug, SheetField, SheetForm, tightenSheetFieldType, updateRow, updateSheetViewColumnOrder, updateSheetViewWidths } from './api';
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

function readStoredTheme() {
  try {
    return window.localStorage?.getItem('sheetbase-theme');
  } catch {
    return null;
  }
}

function storeTheme(theme: 'light' | 'dark') {
  try {
    window.localStorage?.setItem('sheetbase-theme', theme);
  } catch {
    // Theme persistence is optional in restricted browser contexts.
  }
}

export function App({ onSignOut }: { onSignOut?: () => void }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const storedTheme = readStoredTheme();
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const [sheetForm, setSheetForm] = useState<SheetForm | null>(null);
  const [sheetForms, setSheetForms] = useState<SheetForm[]>([]);
  const [formName, setFormName] = useState('Companies');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('Local draft');
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [apiVisible, setApiVisible] = useState(() => window.location.hash === '#api');
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [slugDraft, setSlugDraft] = useState('');
  const [activeFieldIndex, setActiveFieldIndex] = useState<number | null>(null);
  const [headerEditor, setHeaderEditor] = useState<{ columnIndex: number; left: number; top: number; width: number } | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ columnIndex: number; left: number; top: number } | null>(null);
  const hotRef = useRef<HotTableRef>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const apiSummaryRef = useRef<HTMLElement>(null);
  const stencilInputRef = useRef<HTMLInputElement>(null);
  const draftStartedRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const saveToAPIRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    storeTheme(theme);
  }, [theme]);

  useEffect(() => () => {
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestForm() {
      try {
        const forms = await listSheetForms();
        if (!cancelled) setBackendStatus('connected');
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
        if (!cancelled) setBackendStatus('offline');
        // Keep the local draft usable when the API is not up yet.
      }
    }

    void loadLatestForm();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sheetForm && window.location.hash === '#api') setApiVisible(true);
  }, [sheetForm]);

  useEffect(() => {
    setSlugDraft(sheetForm?.slug ?? '');
  }, [sheetForm?.id, sheetForm?.slug]);

  useEffect(() => {
    if (headerEditor) headerInputRef.current?.focus();
  }, [headerEditor]);

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
      setActiveFieldIndex(null);
      setSaveState('saved');
      setSaveMessage('Loaded from database');
    } catch (error) {
      if (isCancelled()) return;
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Load failed');
    }
  };

  const hotData = useMemo(
    () => rows.map((currentRow) => columns.map((column) => currentRow.values[column.key] ?? '')),
    [columns, rows],
  );

  const ensureNextRow = (nextRows: Row[]) => {
    const last = nextRows.at(-1);
    if (!last || Object.values(last.values).some((value) => value.trim() !== '')) {
      return [...nextRows, emptyRow(`draft-${nextRows.length + 1}`, columns)];
    }
    return nextRows;
  };

  const scheduleAutosave = () => {
    setSaveState('idle');
    setSaveMessage('Unsaved changes');
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveToAPIRef.current();
    }, 900);
  };

  const updateHeader = (columnIndex: number, label: string) => {
    setColumns((currentColumns) => currentColumns.map((column, index) => (
      index === columnIndex ? { ...column, label } : column
    )));
    scheduleAutosave();
  };

  const openHeaderEditor = (columnIndex: number, headerCell: HTMLTableCellElement) => {
    const frame = headerCell.closest<HTMLElement>('.table-frame');
    if (!frame) return;
    const headerRect = headerCell.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    setColumnMenu(null);
    setHeaderEditor({
      columnIndex,
      left: headerRect.left - frameRect.left + frame.scrollLeft,
      top: headerRect.top - frameRect.top + frame.scrollTop,
      width: headerRect.width,
    });
  };

  const renderEditableColumnHeader = (columnIndex: number, headerCell: HTMLTableCellElement) => {
    if (columnIndex < 0) return;
    const labelElement = headerCell.querySelector<HTMLElement>('.colHeader');
    const column = columns[columnIndex];
    if (!labelElement || !column) return;

    headerCell.dataset.sheetbaseColumnIndex = String(columnIndex);
    labelElement.classList.add('editable-column-header');
    labelElement.title = 'Double-click to rename';
    const headerContent = headerCell.querySelector<HTMLElement>('.relative');
    let menuButton = headerCell.querySelector<HTMLButtonElement>('.column-menu-trigger');
    if (headerContent && !menuButton) {
      menuButton = document.createElement('button');
      menuButton.className = 'column-menu-trigger';
      menuButton.type = 'button';
      menuButton.innerHTML = '<span aria-hidden="true">•••</span>';
      headerContent.append(menuButton);
    }
    if (menuButton) {
      menuButton.setAttribute('aria-label', `Open ${column.label || `Field ${columnIndex + 1}`} column menu`);
      menuButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const frame = headerCell.closest<HTMLElement>('.table-frame');
        if (!frame) return;
        const headerRect = headerCell.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        setHeaderEditor(null);
        setColumnMenu((current) => current?.columnIndex === columnIndex ? null : {
          columnIndex,
          left: Math.min(headerRect.left - frameRect.left + frame.scrollLeft, frame.clientWidth - 264),
          top: headerRect.bottom - frameRect.top + frame.scrollTop + 4,
        });
      };
    }
    const editableHeaderCell = headerCell as HTMLTableCellElement & { sheetbaseDblClick?: (event: MouseEvent) => void };
    editableHeaderCell.sheetbaseDblClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openHeaderEditor(columnIndex, headerCell);
    };
    if (!headerCell.dataset.inlineEditBound) {
      headerCell.dataset.inlineEditBound = 'true';
      headerCell.addEventListener('dblclick', (event) => {
        editableHeaderCell.sheetbaseDblClick?.(event);
      }, { capture: true });
    }
  };

  const finishHeaderEdit = (commit: boolean) => {
    if (!headerEditor) return;
    const nextLabel = headerInputRef.current?.value.trim() ?? '';
    if (commit && nextLabel) updateHeader(headerEditor.columnIndex, nextLabel);
    setHeaderEditor(null);
    requestAnimationFrame(() => hotRef.current?.hotInstance?.render());
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
    scheduleAutosave();
  };

  const addColumnAt = (targetIndex = columns.length) => {
    setColumns((currentColumns) => {
      const column = newColumn(currentColumns.length);
      setRows((currentRows) => currentRows.map((currentRow) => ({
        ...currentRow,
        values: { ...currentRow.values, [column.key]: '' },
      })));
      const nextColumns = [...currentColumns];
      nextColumns.splice(targetIndex, 0, column);
      requestAnimationFrame(() => hotRef.current?.hotInstance?.selectCell(0, targetIndex));
      setActiveFieldIndex(targetIndex);
      return nextColumns;
    });
    scheduleAutosave();
  };

  const addColumn = () => addColumnAt(columns.length);

  const insertRowAt = (rowIndex: number) => {
    setRows((currentRows) => {
      const nextRows = [...currentRows];
      nextRows.splice(Math.max(0, rowIndex), 0, emptyRow(`draft-${Date.now()}`, columns));
      return ensureNextRow(nextRows);
    });
  };

  const removeRowAt = async (rowIndex: number) => {
    const target = rows[rowIndex];
    if (!target) return;
    if (sheetForm && !target.id.startsWith('draft-')) {
      setSaveState('saving');
      setSaveMessage('Deleting row');
      try {
        await deleteRow(sheetForm.generated_table_name, target.id);
      } catch (error) {
        setSaveState('error');
        setSaveMessage(error instanceof Error ? error.message : 'Could not delete row');
        return;
      }
    }
    setRows((currentRows) => ensureBlankRow(currentRows.filter((_, index) => index !== rowIndex), columns));
    setSaveState('saved');
    setSaveMessage('Row deleted');
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
    setActiveFieldIndex((current) => (current === columnIndex ? targetIndex : current));
    setColumnMenu((current) => current?.columnIndex === columnIndex ? { ...current, columnIndex: targetIndex } : current);
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
      setActiveFieldIndex(null);
      setColumnMenu(null);
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
      setActiveFieldIndex(null);
      setColumnMenu(null);
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
      scheduleAutosave();
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
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
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
      let loadedFields = await listSheetFields(form.id);
      if (existingForm) {
        for (const column of activeColumns) {
          const existingField = column.fieldId ? loadedFields.find((field) => field.id === column.fieldId) : undefined;
          if (existingField && column.label.trim() !== '' && existingField.name !== column.label.trim()) {
            const renamedField = await renameSheetField(form.id, existingField.id, column.label.trim());
            loadedFields = loadedFields.map((field) => field.id === renamedField.id ? renamedField : field);
          }
        }
      }
      const fields = existingForm ? await ensureFields(form.id, headers, loadedFields) : loadedFields;
      const fieldsByName = new Map(fields.map((field) => [field.name.trim().toLowerCase(), field]));
      const resolvedColumns = activeColumns.map((column) => {
        const field = fieldsByName.get(column.label.trim().toLowerCase());
        return field ? { ...column, key: field.column_name, fieldId: field.id, type: field.type as FieldType } : column;
      });
      const changes = rowsToChanges(rows, activeColumns, fields, existingForm);
      for (const change of changes.updates) {
        await updateRow(form.generated_table_name, change.id, change.values);
      }
      const insertedRows = changes.inserts.length > 0
        ? await insertRows<Record<string, string>>(form.generated_table_name, changes.inserts)
        : [];
      await updateSheetViewColumnOrder(form.id, resolvedColumns.map((column) => column.key));
      setColumns(resolvedColumns);
      const insertedIds = new Map(changes.insertRowIds.map((rowId, index) => [rowId, insertedRows[index]?.id]));
      setRows((currentRows) => currentRows.map((currentRow) => ({
        ...currentRow,
        id: insertedIds.get(currentRow.id) ?? currentRow.id,
        values: Object.fromEntries(resolvedColumns.map((column, index) => [
          column.key,
          currentRow.values[activeColumns[index]?.key] ?? currentRow.values[column.key] ?? '',
        ])),
      })));
      setSaveState('saved');
      const savedCount = changes.inserts.length + changes.updates.length;
      setSaveMessage(savedCount === 1 ? 'Saved 1 row' : `Saved ${savedCount} rows`);
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Save failed');
    }
  };

  saveToAPIRef.current = saveToAPI;

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
      setActiveFieldIndex(null);
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
    setActiveFieldIndex(null);
    setSaveState('idle');
    setSaveMessage('Local draft');
    requestAnimationFrame(() => hotRef.current?.hotInstance?.selectCell(0, 0));
  };

  const showAPIEndpoint = () => {
    if (apiVisible) {
      setApiVisible(false);
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    setSaveMessage(sheetForm
      ? `API URL: ${apiURL(sheetForm.generated_table_name)}`
      : 'Save this Sheet Form to create its API endpoint');
    setApiVisible(true);
    window.history.replaceState(null, '', '#api');
    requestAnimationFrame(() => apiSummaryRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const copyAPIText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedSnippet(key);
      window.setTimeout(() => {
        setCopiedSnippet((current) => current === key ? null : current);
      }, 1600);
    } catch {
      setSaveState('error');
      setSaveMessage('Could not copy to clipboard');
    }
  };

  const saveAPISlug = async () => {
    if (!sheetForm || slugDraft.trim() === '' || slugDraft === sheetForm.slug) return;
    setSaveState('saving');
    setSaveMessage('Updating API slug');
    try {
      const updatedForm = await setSheetFormSlug(sheetForm.id, slugDraft);
      setSheetForm(updatedForm);
      setSheetForms((current) => current.map((form) => form.id === updatedForm.id ? updatedForm : form));
      setSlugDraft(updatedForm.slug);
      setSaveState('saved');
      setSaveMessage('API slug updated');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(error instanceof Error ? error.message : 'Could not update API slug');
    }
  };

  const handleGridChange = (changes: Handsontable.CellChange[] | null, source: Handsontable.ChangeSource) => {
    if (!changes || source === 'loadData') return;
    for (const [rowIndex, prop, previousValue, nextValue] of changes) {
      if (previousValue === nextValue) continue;
      const columnIndex = typeof prop === 'number' ? prop : Number(prop);
      if (!Number.isFinite(columnIndex)) continue;
      const column = columns[columnIndex];
      if (!column) continue;
      updateCell(rowIndex, column.key, String(nextValue ?? ''));
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

  const populatedRowCount = rows.filter((currentRow) => (
    Object.values(currentRow.values).some((value) => value.trim() !== '')
  )).length;
  const SaveStateIcon = saveState === 'saving'
    ? LoaderCircle
    : saveState === 'error'
      ? CircleAlert
      : saveState === 'saved'
        ? Check
        : Cloud;
  const saveStateLabel = saveState === 'saving'
    ? 'Saving changes'
    : saveState === 'error'
      ? 'Save needs attention'
      : saveState === 'saved'
        ? 'All changes saved'
        : saveMessage === 'Unsaved changes' ? 'Unsaved changes' : 'Local draft';
  const apiEndpoint = sheetForm ? apiURL(sheetForm.generated_table_name) : '';
  const apiRequests = sheetForm ? [
    { key: 'read', label: 'Read rows', method: 'GET', value: `GET /api/${sheetForm.generated_table_name}?select=*&limit=20` },
    { key: 'create', label: 'Create rows', method: 'POST', value: `POST /api/${sheetForm.generated_table_name}` },
    { key: 'metadata', label: 'Field metadata', method: 'GET', value: `GET /api/sheet_fields?sheet_form_id=eq.${sheetForm.id}&order=position.asc` },
  ] : [];
  const selectedGridCell = () => hotRef.current?.hotInstance?.getSelectedLast() ?? null;
  const gridContextMenu = {
    items: {
      insert_row_above: {
        name: 'Insert row above',
        callback: () => insertRowAt(selectedGridCell()?.[0] ?? 0),
      },
      insert_row_below: {
        name: 'Insert row below',
        callback: () => insertRowAt((selectedGridCell()?.[0] ?? 0) + 1),
      },
      remove_sheet_row: {
        name: 'Delete row',
        callback: () => void removeRowAt(selectedGridCell()?.[0] ?? -1),
      },
      row_separator: '---------',
      add_sheet_field: {
        name: 'Add field after',
        callback: () => addColumnAt((selectedGridCell()?.[1] ?? columns.length - 1) + 1),
      },
      hide_sheet_field: {
        name: 'Hide field',
        callback: () => void hideColumn(selectedGridCell()?.[1] ?? -1),
      },
      edit_separator: '---------',
      undo: { name: 'Undo' },
      redo: { name: 'Redo' },
      copy: { name: 'Copy' },
      cut: { name: 'Cut' },
    },
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="workspace-switcher">
          <div className="mark" aria-hidden="true"><Database size={16} /></div>
          <div>
            <strong>Sheetbase</strong>
            <span>Data workspace</span>
          </div>
          <ChevronDown aria-hidden="true" size={14} />
        </div>

        <Button aria-label="New form" className="nav-action" onClick={createNewForm} type="button" variant="ghost" size="sm">
          <Plus data-icon="inline-start" />
          Create Sheet Form
        </Button>

        <div className="nav-section">
          <div className="section-title">
            <ChevronDown size={14} />
            Sheet Forms
            <span className="section-count">{sheetForms.length || 1}</span>
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
          <div className="sidebar-footer">
            <div className={`workspace-health ${backendStatus}`}>
              <span aria-hidden="true" />
              {backendStatus === 'connected' ? 'Database connected' : backendStatus === 'offline' ? 'Database unavailable' : 'Checking database'}
            </div>
            <Button
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="nav-action theme-action"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              type="button"
              variant="ghost"
              size="sm"
            >
              {theme === 'dark' ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </Button>
            <Button className="nav-action sign-out-action" onClick={onSignOut} type="button" variant="ghost" size="sm">
              Sign out
            </Button>
          </div>
        ) : null}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="title-block">
            <Table2 aria-hidden="true" size={15} />
            <Input
              aria-label="Sheet Form name"
              className="title-input"
              onChange={(event) => {
                setFormName(event.target.value);
                scheduleAutosave();
              }}
              value={formName}
            />
          </div>
          <div className="view-actions">
            <Button
              disabled={saveState === 'saving' || backendStatus === 'offline'}
              onClick={saveToAPI}
              title={backendStatus === 'offline' ? 'Database unavailable' : undefined}
              type="button"
              size="sm"
            >
              {saveState === 'saving' ? <LoaderCircle className="spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              {saveState === 'saving' ? 'Saving' : 'Save'}
            </Button>
            <Button
              aria-expanded={apiVisible}
              aria-label="API"
              onClick={showAPIEndpoint}
              type="button"
              variant="outline"
              size="sm"
            >
              <TerminalSquare data-icon="inline-start" />
              {apiVisible ? 'Hide API' : 'View API'}
            </Button>
          </div>
        </header>

        <div className="table-toolbar" aria-label="Sheet Form tools">
          <div className="table-context">
            <span className={`save-status ${saveState}`} title={saveMessage}>
              <SaveStateIcon aria-hidden="true" className={saveState === 'saving' ? 'spin' : ''} size={13} />
              {saveStateLabel}
            </span>
            <span className="toolbar-divider" aria-hidden="true" />
            <span>{populatedRowCount} {populatedRowCount === 1 ? 'row' : 'rows'}</span>
            <span>{columns.length} {columns.length === 1 ? 'field' : 'fields'}</span>
          </div>
          <div className="toolbar-actions">
            <Button type="button" aria-label="Add column" onClick={addColumn} variant="outline" size="sm">
              <Plus data-icon="inline-start" />
              Add field
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
            {sheetForm ? (
              <Button asChild variant="outline" size="sm">
                <a href="/admin/export">
                  <Download data-icon="inline-start" />
                  Export
                </a>
              </Button>
            ) : (
              <Button disabled title="Save this Sheet Form before exporting a backup" type="button" variant="outline" size="sm">
                <Download data-icon="inline-start" />
                Export
              </Button>
            )}
          </div>
        </div>

        {saveState === 'error' ? (
          <div className="save-error" role="alert">
            {saveMessage}
          </div>
        ) : null}

        {apiVisible ? (
          <section className="api-summary" aria-label="API documentation" ref={apiSummaryRef}>
            {sheetForm ? (
              <>
                <div className="api-panel-heading">
                  <div>
                    <strong>API access</strong>
                    <p>Query and update this sheet through its generated REST endpoint.</p>
                  </div>
                  <span className="api-live-status"><i aria-hidden="true" /> Live</span>
                </div>
                <div className="api-primary">
                  <div className="api-endpoint">
                    <span>Endpoint</span>
                    <div className="api-slug-control">
                      <code>{window.location.origin}/api/</code>
                      <input
                        aria-label="API slug"
                        onChange={(event) => setSlugDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveAPISlug();
                          if (event.key === 'Escape') setSlugDraft(sheetForm.slug);
                        }}
                        spellCheck={false}
                        value={slugDraft}
                      />
                    </div>
                    <Button disabled={slugDraft.trim() === '' || slugDraft === sheetForm.slug} onClick={() => void saveAPISlug()} type="button" variant="ghost" size="sm">
                      Save slug
                    </Button>
                    <Button aria-label="Copy API endpoint" onClick={() => void copyAPIText('endpoint', apiEndpoint)} type="button" variant="ghost" size="sm">
                      {copiedSnippet === 'endpoint' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                      {copiedSnippet === 'endpoint' ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <div className="api-request-list" aria-label="Request examples">
                    {apiRequests.map((request) => (
                      <div className="api-request" key={request.key}>
                        <span className="api-request-label">{request.label}</span>
                        <span className={`api-method ${request.method.toLowerCase()}`}>{request.method}</span>
                        <code>{request.value}</code>
                        <Button aria-label={`Copy ${request.label.toLowerCase()} request`} onClick={() => void copyAPIText(request.key, request.value)} type="button" variant="ghost" size="icon-xs">
                          {copiedSnippet === request.key ? <Check /> : <Copy />}
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="api-filter-help">Supports <code>select</code>, <code>order</code>, <code>limit</code>, <code>offset</code>, and PostgREST filters.</p>
                </div>
                <aside className="api-schema" aria-label="API schema">
                  <div className="api-schema-heading">
                    <strong>Response schema</strong>
                    <span>{columns.length} {columns.length === 1 ? 'field' : 'fields'}</span>
                  </div>
                  <div className="api-schema-fields">
                    {columns.map((column) => (
                      <div className="api-schema-field" key={column.key}>
                        <span>{column.label || column.key}</span>
                        <code>{column.key}</code>
                        <em>{column.type}</em>
                      </div>
                    ))}
                  </div>
                </aside>
              </>
            ) : (
              <div className="api-empty-state">
                <TerminalSquare aria-hidden="true" size={16} />
                <div>
                  <strong>API endpoint not created yet</strong>
                  <p>Save this Sheet Form to create its API endpoint.</p>
                </div>
              </div>
            )}
          </section>
        ) : null}

        <section
          className={`table-frame ${apiVisible ? 'with-api-summary' : ''} ${headerEditor ? 'is-editing-header' : ''}`}
          aria-label={`${formName || 'Untitled'} Sheet Form`}
          data-column-widths={columns.map((column) => column.width).join(',')}
          onClickCapture={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('.column-menu-trigger')) return;
            const label = target.closest<HTMLElement>('.editable-column-header');
            const headerCell = label?.closest<HTMLTableCellElement>('th[data-sheetbase-column-index]');
            if (!headerCell) return;
            const columnIndex = Number(headerCell.dataset.sheetbaseColumnIndex);
            if (!Number.isInteger(columnIndex)) return;
            event.preventDefault();
            event.stopPropagation();
            openHeaderEditor(columnIndex, headerCell);
          }}
          style={{ colorScheme: theme }}
        >
          <HotTable
            ref={hotRef}
            data={hotData}
            className="sheetbase-hot"
            rowHeaders
            colHeaders={columns.map((column, index) => column.label || `Field ${index + 1}`)}
            colWidths={columns.map((column) => column.width)}
            contextMenu={gridContextMenu}
            manualColumnMove
            manualColumnResize
            minSpareRows={1}
            stretchH="all"
            width="100%"
            height="calc(100% - 28px)"
            licenseKey="non-commercial-and-evaluation"
            afterChange={handleGridChange}
            afterGetColHeader={renderEditableColumnHeader}
            afterColumnResize={(newSize: number, columnIndex: number) => {
              if (typeof newSize === 'number') void persistColumnResize(columnIndex, newSize);
            }}
            afterColumnMove={(movedColumns: number[], finalIndex: number, _dropIndex: number | undefined, _movePossible: boolean, orderChanged: boolean) => {
              void persistColumnMove(movedColumns, finalIndex, orderChanged);
            }}
          />
          {columnMenu && columns[columnMenu.columnIndex] ? (
            <div
              aria-label={`${columns[columnMenu.columnIndex].label || `Field ${columnMenu.columnIndex + 1}`} column settings`}
              className="column-menu"
              role="dialog"
              style={{ left: columnMenu.left, top: columnMenu.top }}
            >
              <div className="column-menu-heading">
                <div>
                  <strong>Column settings</strong>
                  <code>{columns[columnMenu.columnIndex].key}</code>
                </div>
                <Button aria-label="Close column settings" onClick={() => setColumnMenu(null)} type="button" variant="ghost" size="icon-xs">
                  <X />
                </Button>
              </div>
              <label>
                Name
                <input
                  aria-label="Column name"
                  onChange={(event) => updateHeader(columnMenu.columnIndex, event.target.value)}
                  value={columns[columnMenu.columnIndex].label}
                />
              </label>
              <label>
                Type
                <select
                  aria-label="Column type"
                  onChange={(event) => void tightenColumnType(columnMenu.columnIndex, event.target.value as FieldType)}
                  value={dbFieldTypes.includes(columns[columnMenu.columnIndex].type as typeof dbFieldTypes[number]) ? columns[columnMenu.columnIndex].type : 'text'}
                >
                  {dbFieldTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <div className="column-menu-meta">
                <span>API field</span>
                <code>{columns[columnMenu.columnIndex].key}</code>
              </div>
              <div className="column-menu-actions">
                <Button aria-label="Move column left" disabled={columnMenu.columnIndex === 0} onClick={() => void moveColumn(columnMenu.columnIndex, -1)} type="button" variant="outline" size="icon-xs">
                  <ArrowLeft />
                </Button>
                <Button aria-label="Move column right" disabled={columnMenu.columnIndex === columns.length - 1} onClick={() => void moveColumn(columnMenu.columnIndex, 1)} type="button" variant="outline" size="icon-xs">
                  <ArrowRight />
                </Button>
                <Button className="column-menu-hide" onClick={() => void hideColumn(columnMenu.columnIndex)} type="button" variant="ghost" size="sm">
                  <EyeOff data-icon="inline-start" />
                  Hide field
                </Button>
              </div>
            </div>
          ) : null}
          {headerEditor ? (
            <input
              ref={headerInputRef}
              aria-label={`Edit ${columns[headerEditor.columnIndex]?.label || `Field ${headerEditor.columnIndex + 1}`} column header`}
              className="column-header-input"
              defaultValue={columns[headerEditor.columnIndex]?.label ?? ''}
              onBlur={() => finishHeaderEdit(true)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  finishHeaderEdit(true);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  finishHeaderEdit(false);
                }
              }}
              style={{ left: headerEditor.left, top: headerEditor.top, width: Math.max(80, headerEditor.width) }}
            />
          ) : null}
          <footer className="table-statusbar" aria-label="Table status">
            <span>
              <span className={`status-dot ${backendStatus}`} aria-hidden="true" />
              {backendStatus === 'offline' ? 'Offline draft' : sheetForm ? 'Connected to PostgreSQL' : 'Local draft'}
            </span>
            <span>Changes save automatically</span>
            <span className="keyboard-hint"><kbd>↵</kbd> edit cell <kbd>Tab</kbd> move</span>
          </footer>
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
  const insertRowIds: string[] = [];
  const updates: Array<{ id: string; values: Record<string, string> }> = [];
  for (const currentRow of rows) {
    const values = rowToPayload(currentRow, columns, fields);
    if (Object.keys(values).length === 0) continue;
    if (updateExisting && !currentRow.id.startsWith('draft-')) {
      updates.push({ id: currentRow.id, values });
    } else {
      inserts.push(values);
      insertRowIds.push(currentRow.id);
    }
  }
  return { inserts, insertRowIds, updates };
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
