// Tab inventory page
import { observable, computed, action, makeObservable, configure, autorun } from 'mobx';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as messaging from './messaging';
import * as backgroundTypes from './background';

configure({
    useProxies: 'always',
    // computedRequiresReaction: true,
    enforceActions: 'always',
    // observableRequiresReaction: true,
    // reactionRequiresObservable: true,
    // safeDescriptors: false,
});

// ── Constants ────────────────────────────────────────────────────────────────

const GROUP_COLOR_EMOJI: Dict<string> = {
  grey:   '⚫',
  blue:   '🔵',
  red:    '🔴',
  yellow: '🟡',
  green:  '🟢',
  pink:   '🩷',
  purple: '🟣',
  cyan:   '🩵',
  orange: '🟠',
};

const GROUP_COLOR_HEX: Dict<string> = {
  grey:   '#dadce0',
  blue:   '#4285f4',
  red:    '#ea4335',
  yellow: '#fbbc04',
  green:  '#34a853',
  pink:   '#ff63b8',
  purple: '#a142f4',
  cyan:   '#24c1e0',
  orange: '#fa903e',
};

// ── MobX stores ──────────────────────────────────────────────────────────────

// This class is immutable, so doesn't need to have observable fields
class WindowData {
  window: chrome.windows.Window;
  tabs: chrome.tabs.Tab[];
  groups: chrome.tabGroups.TabGroup[];

  constructor(win: chrome.windows.Window, tabs: chrome.tabs.Tab[], groups: chrome.tabGroups.TabGroup[]) {
    this.window = win;
    this.tabs = tabs;
    this.groups = groups;
  }
}

class InventoryStore {
  @observable.shallow accessor windows: WindowData[] = [];

  @action setWindows(windows: WindowData[]) {
    this.windows = windows;
  }

  @action reorderWindows(fromIndex: number, toIndex: number) {
    const next = this.windows.slice();
    const moved = next.splice(fromIndex, 1)[0]!;
    next.splice(toIndex, 0, moved);
    this.windows = next;
  }

  @computed get duplicates(): { urls: Set<string>; groupTitles: Set<string> } {
    const urlCounts = new Map<string, number>();
    const groupTitleCounts = new Map<string, number>();
    for (const { tabs, groups } of this.windows) {
      for (const tab of tabs) {
        if (tab.url) urlCounts.set(tab.url, (urlCounts.get(tab.url) ?? 0) + 1);
      }
      for (const group of groups) {
        if (group.title) groupTitleCounts.set(group.title, (groupTitleCounts.get(group.title) ?? 0) + 1);
      }
    }
    const ret = {
      urls: new Set<string>(),
      groupTitles: new Set<string>()
    };
    for(const [u, n] of urlCounts.entries()) {
      if(n > 1) ret.urls.add(u);
    }
    for(const [u, n] of groupTitleCounts.entries()) {
      if(n > 1) ret.groupTitles.add(u);
    }
    return ret;
  }
}

class WindowNamesStore {
  @observable accessor names: Map<number, string> = new Map();

  @action setNames(names: Map<number, string>) {
    this.names = names;
  }

  @action setName(windowId: number, name: string | null) {
    // ai? why did you write this code this way?
    if (name != null) {
      this.names.set(windowId, name);
    } else {
      this.names.delete(windowId);
    }
  }

  windowDisplayName(win: chrome.windows.Window): string {
    const custom = win.id != null ? this.names.get(win.id) : undefined;
    if (custom) return `${custom} (Window ${win.id})`;
    return `Window ${win.id}`;
  }
}

class UIStore {
  @observable accessor autoRefresh: boolean = false;

  @action setAutoRefresh(value: boolean) {
    this.autoRefresh = value;
  }
}

const inventoryStore = new InventoryStore();
const windowNamesStore = new WindowNamesStore();
const uiStore = new UIStore();

// ── Refresh ──────────────────────────────────────────────────────────────────

async function refresh() {
  const [entries, namesSerialized] = await Promise.all([
    background.getTabInventory(),
    background.getWindowNames(),
  ]);
  const names = messaging.deserializeMap(namesSerialized);
  windowNamesStore.setNames(names);
  inventoryStore.setWindows(entries.map(({ window: win, tabs, groups }) => new WindowData(win, tabs, groups)));
}

// ── Markdown export ───────────────────────────────────────────────────────────

function windowToMarkdownLines(
  winData: WindowData,
  dupUrls: Set<string>,
  dupGroupTitles: Set<string>,
): string[] {
  const { window: win, tabs, groups } = winData;
  const lines: string[] = [];
  lines.push(`# ${windowNamesStore.windowDisplayName(win)}`);
  lines.push('');

  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const renderedGroups = new Set<number>();

  for (const tab of tabs) {
    const inGroup = tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
    const group = inGroup ? groupMap.get(tab.groupId!) : undefined;

    if (group && !renderedGroups.has(group.id)) {
      renderedGroups.add(group.id);
      const emoji = GROUP_COLOR_EMOJI[group.color] ?? '⚪';
      const isDup = group.title && dupGroupTitles.has(group.title);
      const groupTitle = isDup ? `${group.title} [DUPLICATE]` : (group.title ?? '(unnamed group)');
      lines.push(`- ${isDup ? '⚠️ ' : ''}${emoji} ${groupTitle}`);
    }

    const isDupUrl = tab.url ? dupUrls.has(tab.url) : false;
    const title = tab.title ?? tab.url ?? '(untitled)';
    const indent = inGroup ? '  ' : '';
    const dupPrefix = isDupUrl ? '⚠️ ' : '';
    const dupSuffix = isDupUrl ? ' [DUPLICATE]' : '';
    lines.push(`${indent}- ${dupPrefix}[${title}](${tab.url ?? ''})${dupSuffix}`);
  }

  return lines;
}

function toMarkdown(windows: WindowData[]): string {
  const { urls: dupUrls, groupTitles: dupGroupTitles } = inventoryStore.duplicates;
  const lines: string[] = [];
  for (const winData of windows) {
    lines.push(...windowToMarkdownLines(winData, dupUrls, dupGroupTitles));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function toMarkdownWindow(winData: WindowData): string {
  const { urls: dupUrls, groupTitles: dupGroupTitles } = inventoryStore.duplicates;
  return windowToMarkdownLines(winData, dupUrls, dupGroupTitles).join('\n').trimEnd();
}

// ── Components ────────────────────────────────────────────────────────────────

const Summary = observer(() => {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div id="summary" className="mb-6 space-y-0.5">
      {inventoryStore.windows.map((winData, i) => {
        const win = winData.window;
        const label = win.focused
          ? `${windowNamesStore.windowDisplayName(win)} (focused)`
          : windowNamesStore.windowDisplayName(win);
        const isOver = dragOverIndex === i;
        return (
          <a
            key={win.id}
            href={`#window-${win.id}`}
            draggable
            className={`block text-blue-600 hover:underline text-xs cursor-grab${isOver ? ' outline-2 outline-blue-400 rounded' : ''}`}
            onDragStart={(e) => {
              dragIndex.current = i;
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOverIndex(i);
            }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== i) {
                inventoryStore.reorderWindows(dragIndex.current, i);
              }
              dragIndex.current = null;
              setDragOverIndex(null);
            }}
            onDragEnd={() => {
              dragIndex.current = null;
              setDragOverIndex(null);
            }}
          >
            {label}
          </a>
        );
      })}
    </div>
  );
});

interface WindowProps {
  data: WindowData;
}

const Window = observer((props: WindowProps) => {
  const { data } = props;
  const win = data.window;
  const { urls: dupUrls, groupTitles: dupGroupTitles } = inventoryStore.duplicates;

  const state = useLocalObservable(() => ({
    isRenaming: false,
    renameValue: '',
    copied: false,
  }));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [state.isRenaming]);

  function startRename() {
    state.renameValue = win.id != null ? windowNamesStore.names.get(win.id) ?? '' : '';
    state.isRenaming = true;
  }

  async function commitRename() {
    const name = state.renameValue.trim() || null;
    await background.setWindowName(win.id!, name);
    windowNamesStore.setName(win.id!, name);
    state.isRenaming = false;
  }

  function cancelRename() {
    state.isRenaming = false;
  }

  async function copyWindow() {
    await navigator.clipboard.writeText(toMarkdownWindow(data));
    state.copied = true;
    setTimeout(() => { state.copied = false; }, 1500);
  }

  const displayName = win.focused
    ? `${windowNamesStore.windowDisplayName(win)} (focused)`
    : windowNamesStore.windowDisplayName(win);

  const groupMap = new Map(data.groups.map((g) => [g.id, g]));
  const renderedGroups = new Set<number>();

  return (
    <section id={`window-${win.id}`} className="border border-gray-200 rounded p-3 space-y-1">
      <div className="flex items-center gap-2 mb-2">
        {state.isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={state.renameValue}
            placeholder="Custom name (blank to clear)"
            className="border border-blue-400 rounded px-2 py-0.5 text-sm font-semibold w-64 outline-none"
            onChange={(e) => { state.renameValue = e.target.value; }}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.blur();
              if (e.key === 'Escape') { cancelRename(); }
            }}
          />
        ) : (
          <h2
            className="font-semibold text-base cursor-pointer hover:text-blue-600"
            title="Click to set a custom name for this window"
            onClick={startRename}
          >
            {displayName}
          </h2>
        )}
        <button
          className="px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-xs"
          onClick={copyWindow}
        >
          {state.copied ? 'Copied!' : 'Copy as Markdown'}
        </button>
      </div>

      {data.tabs.map((tab) => {
        const inGroup = tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
        const group = inGroup ? groupMap.get(tab.groupId!) : undefined;
        const isDupUrl = tab.url ? dupUrls.has(tab.url) : false;

        const groupHeader = (() => {
          if (!group || renderedGroups.has(group.id)) return null;
          renderedGroups.add(group.id);
          const isDupGroup = !!(group.title && dupGroupTitles.has(group.title));
          return (
            <div key={`group-${group.id}`} className="mt-2 mb-0.5 flex items-center gap-1.5 font-medium text-xs text-gray-600">
              <span style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '3px',
                background: GROUP_COLOR_HEX[group.color] ?? '#ccc',
                flexShrink: 0,
              }} />
              {isDupGroup && <span>⚠️</span>}
              <span>{isDupGroup ? `${group.title} [DUPLICATE]` : (group.title ?? '(unnamed group)')}</span>
            </div>
          );
        })();

        return (
          <div key={tab.id}>
            {groupHeader}
            <div className={`${inGroup ? 'ml-4' : ''} truncate text-xs`}>
              {isDupUrl && <span>⚠️ </span>}
              <a
                href={tab.url ?? '#'}
                className="text-blue-600 hover:underline"
                title={tab.url ?? ''}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey || e.button === 1) return;
                  e.preventDefault();
                  if (tab.id !== undefined) {
                    chrome.tabs.update(tab.id, { active: true });
                    if (tab.windowId !== undefined) {
                      chrome.windows.update(tab.windowId, { focused: true });
                    }
                  }
                }}
              >
                {tab.title ?? tab.url ?? '(untitled)'}
              </a>
              {isDupUrl && <span> [DUPLICATE]</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
});

const Inventory = observer(() => {
  return (
    <div id="inventory" className="space-y-4">
      {inventoryStore.windows.map((winData) => (
        <Window key={winData.window.id} data={winData} />
      ))}
    </div>
  );
});

const Root = observer(() => {
  const state = useLocalObservable(() => ({ exportCopied: false }));

  useEffect(() => {
    chrome.storage.local.get('autoRefresh', (result) => {
      uiStore.setAutoRefresh((result.autoRefresh as boolean | undefined) ?? false);
    });
  }, []);

  function handleAutoRefreshChange(e: React.ChangeEvent<HTMLInputElement>) {
    uiStore.setAutoRefresh(e.target.checked);
    chrome.storage.local.set({ autoRefresh: e.target.checked });
  }

  async function handleExport() {
    await navigator.clipboard.writeText(toMarkdown(inventoryStore.windows));
    state.exportCopied = true;
    setTimeout(() => { state.exportCopied = false; }, 1500);
  }

  return (
    <div className="p-6 font-sans text-sm">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold">Tab Inventory</h1>
        <button
          className="px-3 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white text-xs"
          onClick={refresh}
        >
          Refresh
        </button>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={uiStore.autoRefresh}
            onChange={handleAutoRefreshChange}
          />
          Auto-refresh
        </label>
        <button
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
          onClick={handleExport}
        >
          {state.exportCopied ? 'Copied!' : 'Copy as Markdown'}
        </button>
        <button
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
          onClick={() => background.reloadExtension()}
        >
          Reload extension
        </button>
      </div>
      <Summary />
      <Inventory />
    </div>
  );
});

// --- Bind messaging ---

class BackgroundService implements backgroundTypes.BackgroundService {
  getTabInventory(): Promise<backgroundTypes.WindowEntry[]> {
    return messaging.send<backgroundTypes.BackgroundService, 'getTabInventory'>('getTabInventory');
  }
  getWindowNames(): Promise<messaging.SerializedMap<number, string>> {
    return messaging.send<backgroundTypes.BackgroundService, 'getWindowNames'>('getWindowNames');
  }
  setWindowName(windowId: number, name: string | null): Promise<void> {
    return messaging.send<backgroundTypes.BackgroundService, 'setWindowName'>('setWindowName', windowId, name);
  }
  reloadExtension(): Promise<void> {
    return messaging.send<backgroundTypes.BackgroundService, 'reloadExtension'>('reloadExtension');
  }
  ensureOffscreen(): Promise<void> {
    return messaging.send<backgroundTypes.BackgroundService, 'ensureOffscreen'>('ensureOffscreen');
  }
  sandbox(): Promise<string> {
    return messaging.send<backgroundTypes.BackgroundService, 'sandbox'>('sandbox');
  }
}
const background = new BackgroundService();

function autoRefreshIfEnabled() {
  if (uiStore.autoRefresh) refresh();
}
messaging.onNotification('tabInventoryChanged', autoRefreshIfEnabled);
autorun(autoRefreshIfEnabled);

// ── Bind UI ─────────────────────────────────────────────────────────────────

// console.dir(await background.sandbox());

const root = createRoot(document.getElementById('root')!);
root.render(<Root />);

// --- Load initial data ---

refresh();
