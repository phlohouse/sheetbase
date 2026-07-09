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
  Search,
  Settings,
  Sparkles,
  Table2,
  TerminalSquare,
} from 'lucide-react';
import { useMemo, useState } from 'react';

type FieldType = 'text' | 'url' | 'link' | 'score' | 'currency' | 'status';

interface Column {
  key: string;
  label: string;
  type: FieldType;
  width: number;
}

interface Row {
  id: string;
  values: Record<string, string | string[]>;
}

const forms = [
  { name: 'Companies', count: 12, active: true },
  { name: 'Customers', count: 8 },
  { name: 'Requests', count: 24 },
  { name: 'Deployments', count: 5 },
];

const columns: Column[] = [
  { key: 'company', label: 'Company', type: 'text', width: 260 },
  { key: 'domain', label: 'Domain', type: 'url', width: 190 },
  { key: 'source', label: 'Source records', type: 'link', width: 280 },
  { key: 'fit', label: 'Schema fit', type: 'score', width: 150 },
  { key: 'records', label: 'Rows', type: 'currency', width: 140 },
  { key: 'api', label: 'API status', type: 'status', width: 160 },
];

const rows: Row[] = [
  {
    id: 'vercel',
    values: {
      company: 'Vercel',
      domain: 'vercel.com',
      source: ['Website leads', 'Enterprise'],
      fit: 'Excellent',
      records: '1,248',
      api: 'Live',
    },
  },
  {
    id: 'digitalocean',
    values: {
      company: 'DigitalOcean',
      domain: 'digitalocean.com',
      source: ['Cloud accounts'],
      fit: 'Medium',
      records: '904',
      api: 'Live',
    },
  },
  {
    id: 'github',
    values: {
      company: 'GitHub',
      domain: 'github.com',
      source: ['Developer tools', 'Open source'],
      fit: 'Good',
      records: '2,010',
      api: 'Live',
    },
  },
  {
    id: 'stripe',
    values: {
      company: 'Stripe',
      domain: 'stripe.com',
      source: ['Payments'],
      fit: 'Good',
      records: '1,620',
      api: 'Live',
    },
  },
  {
    id: 'figma',
    values: {
      company: 'Figma',
      domain: 'figma.com',
      source: ['Design ops'],
      fit: 'Good',
      records: '812',
      api: 'Draft',
    },
  },
  {
    id: 'intercom',
    values: {
      company: 'Intercom',
      domain: 'intercom.com',
      source: ['Support', 'Expansion'],
      fit: 'Medium',
      records: '694',
      api: 'Live',
    },
  },
  {
    id: 'segment',
    values: {
      company: 'Segment',
      domain: 'segment.com',
      source: ['Warehouse sync'],
      fit: 'Good',
      records: '550',
      api: 'Live',
    },
  },
  {
    id: 'notion',
    values: {
      company: 'Notion',
      domain: 'notion.so',
      source: ['Workspace import'],
      fit: 'Medium',
      records: '438',
      api: 'Draft',
    },
  },
  {
    id: 'slack',
    values: {
      company: 'Slack',
      domain: 'slack.com',
      source: ['Team directory'],
      fit: 'Low',
      records: '315',
      api: 'Paused',
    },
  },
];

const iconByType: Record<FieldType, React.ComponentType<{ size?: number }>> = {
  text: Table2,
  url: Sparkles,
  link: Columns3,
  score: Braces,
  currency: Database,
  status: TerminalSquare,
};

export function App() {
  const [activeCell, setActiveCell] = useState({ row: rows[0].id, column: columns[0].key });
  const templateColumns = useMemo(
    () => `44px ${columns.map((column) => `${column.width}px`).join(' ')}`,
    [],
  );

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
            <button className="toolbar-button" type="button">
              <Import size={16} />
              Import Stencil config
            </button>
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
          <button className="add-filter" type="button" aria-label="Add filter">
            <Plus size={17} />
          </button>
        </section>

        <section className="table-frame" aria-label="Companies Sheet Form">
          <div className="data-grid" style={{ gridTemplateColumns: templateColumns }}>
            <div className="cell header select-cell">
              <input aria-label="Select all rows" type="checkbox" />
            </div>
            {columns.map((column) => {
              const Icon = iconByType[column.type];
              return (
                <button className="cell header column-header" key={column.key} type="button">
                  <Icon size={15} />
                  <span>{column.label}</span>
                  <em>{column.type}</em>
                </button>
              );
            })}

            {rows.map((row) => (
              <RowCells
                activeCell={activeCell}
                columns={columns}
                key={row.id}
                onFocusCell={setActiveCell}
                row={row}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

interface RowCellsProps {
  activeCell: { row: string; column: string };
  columns: Column[];
  onFocusCell: (cell: { row: string; column: string }) => void;
  row: Row;
}

function RowCells({ activeCell, columns, onFocusCell, row }: RowCellsProps) {
  return (
    <>
      <div className="cell select-cell">
        <input aria-label={`Select ${row.values.company}`} type="checkbox" />
      </div>
      {columns.map((column) => {
        const value = row.values[column.key];
        const isActive = activeCell.row === row.id && activeCell.column === column.key;
        return (
          <button
            className={`cell data-cell ${isActive ? 'active-cell' : ''}`}
            key={column.key}
            onClick={() => onFocusCell({ row: row.id, column: column.key })}
            type="button"
          >
            <CellValue column={column} value={value} />
          </button>
        );
      })}
    </>
  );
}

function CellValue({ column, value }: { column: Column; value: string | string[] }) {
  if (Array.isArray(value)) {
    return (
      <span className="tag-list">
        {value.map((item) => (
          <span className="tag neutral" key={item}>{item}</span>
        ))}
      </span>
    );
  }

  if (column.type === 'url') {
    return <span className="tag url">{value}</span>;
  }

  if (column.type === 'score') {
    return <span className={`tag score-${value.toLowerCase()}`}>{value}</span>;
  }

  if (column.type === 'currency') {
    return <span className="tag cyan">{value} rows</span>;
  }

  if (column.type === 'status') {
    return <span className={`status status-${value.toLowerCase()}`}>{value}</span>;
  }

  return <span className="primary-value">{value}</span>;
}
