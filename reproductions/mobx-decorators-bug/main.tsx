import { observable, computed, action, configure, autorun } from 'mobx';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

configure({
  useProxies: 'always',
  enforceActions: 'always',
});

// ── Decorator detection ───────────────────────────────────────────────────────

function detectDecoratorType(...args: any[]) {
  const isStandard = args.length === 2 && typeof args[1] === 'object' && 'kind' in args[1];
  const isLegacy = args.length === 3 || (args.length === 1 && typeof args[0] === 'function');

  if (isStandard) {
    console.log('✅ Using ES Standard Decorators (Stage 3)');
  } else if (isLegacy) {
    console.log('⚠️ Using Legacy Experimental Decorators');
  } else {
    console.log('❓ Unknown decorator format', args.length, args);
  }
}

@detectDecoratorType
class TestDetection {
  @detectDecoratorType
  testMethod() {}
}
void TestDetection;

// ── Plain data types ──────────────────────────────────────────────────────────

class BarItem {
  url: string;
  groupId: number;
  constructor(url: string, groupId: number) {
    this.url = url;
    this.groupId = groupId;
  }
}

class BazItem {
  id: number;
  title: string;
  constructor(id: number, title: string) {
    this.id = id;
    this.title = title;
  }
}

// Mirrors WindowData — immutable, no MobX needed
class FooItem {
  id: number;
  bars: BarItem[];
  bazs: BazItem[];
  constructor(id: number, bars: BarItem[], bazs: BazItem[]) {
    this.id = id;
    this.bars = bars;
    this.bazs = bazs;
  }
}

// ── Stores ────────────────────────────────────────────────────────────────────

// Mirrors InventoryStore
class FooStore {
  @observable.shallow accessor foos: FooItem[] = [];

  @action setFoos(foos: FooItem[]) {
    this.foos = foos;
  }

  @computed get duplicates(): { urls: Set<string>; titles: Set<string> } {
    // Error triggers before body of `duplicates` even executes, so logic is not important.
    const ret = { urls: new Set<string>(), titles: new Set<string>() };
    // Unless! this was throwing an error which was being swallowed? Nah
    return ret;
  }
}

// Mirrors WindowNamesStore
class QuxStore {
  @observable accessor names: Map<number, string> = new Map();

  @action setNames(names: Map<number, string>) {
    this.names = names;
  }

  @action setName(id: number, name: string | null) {
    if (name != null) {
      this.names.set(id, name);
    } else {
      this.names.delete(id);
    }
  }

  displayName(foo: FooItem): string {
    const custom = this.names.get(foo.id);
    if (custom) return `${custom} (Foo ${foo.id})`;
    return `Foo ${foo.id}`;
  }
}

// Mirrors UIStore
class QuuxStore {
  @observable accessor autoRefresh: boolean = false;

  @action setAutoRefresh(value: boolean) {
    this.autoRefresh = value;
  }
}

const fooStore = new FooStore();
const quxStore = new QuxStore();
const quuxStore = new QuuxStore();

// ── Test data ─────────────────────────────────────────────────────────────────

const testFoos: FooItem[] = [
  new FooItem(
    1,
    [
      new BarItem('https://example.com', -1),
      new BarItem('https://example.com', 1),  // duplicate url
      new BarItem('https://unique-a.com', -1),
    ],
    [
      new BazItem(1, 'My Group'),
    ]
  ),
  new FooItem(
    2,
    [
      new BarItem('https://other.com', -1),
      new BarItem('https://unique-b.com', 2),
    ],
    [
      new BazItem(2, 'My Group'),  // duplicate title
    ]
  ),
];

// ── Components ────────────────────────────────────────────────────────────────

const SummaryView = observer(() => {
  return (
    <div id="summary">
      {fooStore.foos.map((foo) => (
        <a key={foo.id} href={`#foo-${foo.id}`} style={{ display: 'block' }}>
          {quxStore.displayName(foo)}
        </a>
      ))}
    </div>
  );
});

interface FooViewProps {
  data: FooItem;
}

const FooView = observer((props: FooViewProps) => {
  const { data } = props;
  const { urls: dupUrls, titles: dupTitles } = fooStore.duplicates;

  const state = useLocalObservable(() => ({
    isEditing: false,
    editValue: '',
    copied: false,
  }));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.isEditing) inputRef.current?.focus();
  }, [state.isEditing]);

  function startEdit() {
    state.editValue = quxStore.names.get(data.id) ?? '';
    state.isEditing = true;
  }

  function commitEdit() {
    const name = state.editValue.trim() || null;
    quxStore.setName(data.id, name);
    state.isEditing = false;
  }

  function cancelEdit() {
    state.isEditing = false;
  }

  const displayName = quxStore.displayName(data);

  const bazMap = new Map(data.bazs.map((b) => [b.id, b]));
  const renderedBazs = new Set<number>();

  return (
    <section id={`foo-${data.id}`} style={{ border: '1px solid #ccc', padding: '8px', marginBottom: '8px' }}>
      <div>
        {state.isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={state.editValue}
            placeholder="Custom name (blank to clear)"
            onChange={(e) => { state.editValue = e.target.value; }}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.blur();
              if (e.key === 'Escape') cancelEdit();
            }}
          />
        ) : (
          <strong onClick={startEdit} style={{ cursor: 'pointer' }}>{displayName}</strong>
        )}
      </div>

      {data.bars.map((bar, i) => {
        const inBaz = bar.groupId !== -1;
        const baz = inBaz ? bazMap.get(bar.groupId) : undefined;
        const isDupUrl = dupUrls.has(bar.url);

        const bazHeader = (() => {
          if (!baz || renderedBazs.has(baz.id)) return null;
          renderedBazs.add(baz.id);
          const isDupBaz = dupTitles.has(baz.title);
          return (
            <div key={`baz-${baz.id}`} style={{ fontWeight: 'bold', fontSize: '0.85em' }}>
              {isDupBaz ? `⚠️ ${baz.title} [DUPLICATE]` : baz.title}
            </div>
          );
        })();

        return (
          <div key={i}>
            {bazHeader}
            <div style={{ marginLeft: inBaz ? '16px' : '0', fontSize: '0.85em' }}>
              {isDupUrl && <span>⚠️ </span>}
              <a href={bar.url}>{bar.url}</a>
              {isDupUrl && <span> [DUPLICATE]</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
});

const FooListView = observer(() => {
  return (
    <div id="foo-list">
      {fooStore.foos.map((foo) => (
        <FooView key={foo.id} data={foo} />
      ))}
    </div>
  );
});

const RootView = observer(() => {
  const state = useLocalObservable(() => ({ exportCopied: false }));

  function handleRefresh() {
    fooStore.setFoos(testFoos);
  }

  function handleExport() {
    const lines = fooStore.foos.map((foo) => `- ${quxStore.displayName(foo)}`);
    navigator.clipboard.writeText(lines.join('\n'));
    state.exportCopied = true;
    setTimeout(() => { state.exportCopied = false; }, 1500);
  }

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', fontSize: '14px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>MobX Repro</h1>
        <button onClick={handleRefresh}>Refresh</button>
        <label>
          <input
            type="checkbox"
            checked={quuxStore.autoRefresh}
            onChange={(e) => quuxStore.setAutoRefresh(e.target.checked)}
          />
          {' '}Auto-refresh
        </label>
        <button onClick={handleExport}>
          {state.exportCopied ? 'Copied!' : 'Copy as text'}
        </button>
      </div>
      <SummaryView />
      <FooListView />
    </div>
  );
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

autorun(() => {
  if (quuxStore.autoRefresh) fooStore.setFoos(testFoos);
});

const root = createRoot(document.getElementById('root')!);
root.render(<RootView />);

fooStore.setFoos(testFoos);
