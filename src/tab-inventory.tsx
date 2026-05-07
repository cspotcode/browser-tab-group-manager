// Tab inventory page
import { observable, computed, action, makeObservable, configure, autorun } from 'mobx';
import { observer, useLocalObservable } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as messaging from './messaging';
import { GROUP_COLOR_HEX } from './tab-group-colors';
import { windowToMarkdown, windowsToMarkdown, copyMarkdown } from './markdown';
import { type ArchivedWindow, type ActiveWindow, windowDisplayName } from './window';
import type { LocalStorage } from './local-storage';
import { BackgroundService } from './background-service-client';

configure({
    useProxies: 'always',
    // computedRequiresReaction: true,
    enforceActions: 'always',
    // observableRequiresReaction: true,
    // reactionRequiresObservable: true,
    // safeDescriptors: false,
});

type TabInventoryTab = 'windows' | 'archive';

// ── MobX stores ──────────────────────────────────────────────────────────────

class InventoryStore {
  @observable accessor windows: ActiveWindow[] = [];
  @observable accessor archivedWindows: ArchivedWindow[] = [];

  @action setWindows(windows: ActiveWindow[]) {
    this.windows = windows;
  }

  @action setArchivedWindows(windows: ArchivedWindow[]) {
    this.archivedWindows = windows;
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
    for (const win of this.windows) {
      for (const item of win.items) {
        if(item.type === 'ungroupedTab') {
          const tab = item.tab;
          if (tab.url) urlCounts.set(tab.url, (urlCounts.get(tab.url) ?? 0) + 1);
        } else {
          const group = item.group;
          if (group.name) groupTitleCounts.set(group.name, (groupTitleCounts.get(group.name) ?? 0) + 1);
          for (const tab of group.tabs) {
            if (tab.url) urlCounts.set(tab.url, (urlCounts.get(tab.url) ?? 0) + 1);
          }
        }
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

class UIStore {
  @observable accessor autoRefresh: boolean = false;
  @observable accessor activeTab: TabInventoryTab = 'windows';

  @action setAutoRefresh(value: boolean) {
    this.autoRefresh = value;
  }

  @action setActiveTab(tab: TabInventoryTab) {
    this.activeTab = tab;
  }
}

const inventoryStore = new InventoryStore();
// const windowNamesStore = new WindowNamesStore();
const uiStore = new UIStore();

// ── Components ────────────────────────────────────────────────────────────────

const Summary = observer(() => {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div id="summary" className="mb-6 space-y-0.5">
      {inventoryStore.windows.map((winData, i) => {
        const chromeWin = winData.chromeWindow;
        const label = chromeWin.focused ? `${winData.name} (focused)` : winData.name;
        const isOver = dragOverIndex === i;
        return (
          <a
            key={chromeWin.id}
            href={`#window-${chromeWin.id}`}
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

interface ActiveWindowProps {
  win: ActiveWindow;
}

const ActiveWindow = observer((props: ActiveWindowProps) => {
  const { win } = props;
  const chromeWin = win.chromeWindow;
  const { urls: dupUrls, groupTitles: dupGroupTitles } = inventoryStore.duplicates;

  const state = useLocalObservable(() => ({
    isRenaming: false,
    renameValue: '',
    copied: false,
    archiving: false,
  }));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [state.isRenaming]);

  function startRename() {
    state.renameValue = win.name ?? '';
    state.isRenaming = true;
  }

  async function commitRename() {
    const name = state.renameValue.trim() || undefined;
    await background.setWindowName(chromeWin.id!, name);
    // Optimistic update in the frontend
    win.name = name;
    state.isRenaming = false;
  }

  function cancelRename() {
    state.isRenaming = false;
  }

  async function copyWindowMarkdown() {
    await copyMarkdown(windowToMarkdown(win));
    state.copied = true;
    setTimeout(() => { state.copied = false; }, 1500);
  }

  async function handleArchiveWindow(keepWindow: boolean) {
    if (!chromeWin.id) throw new Error('Window ID is missing');
    try {
      state.archiving = true;
      await background.archiveWindow(chromeWin.id, keepWindow, false);
      await refresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.startsWith('ARCHIVE_EXISTS:')) {
        const archiveName = errorMsg.slice('ARCHIVE_EXISTS:'.length);
        const confirmed = confirm(
          `An archive named "${archiveName}" already exists. Do you want to overwrite it?\n\n` +
          `This will delete the existing bookmarks in the archive and replace them with the current window's tabs.`
        );
        if (confirmed) {
          state.archiving = true;
          await background.archiveWindow(chromeWin.id, keepWindow, true);
          await refresh();
        }
      } else {
        console.error('Error archiving window:', error);
        throw error;
      }
    } finally {
      state.archiving = false;
    }
  }

  const _displayName = windowDisplayName(win);
  const displayName = chromeWin.focused ? `${_displayName} (focused)` : _displayName;

  return (
    <section id={`window-${chromeWin.id}`} className="border border-gray-200 rounded p-3 space-y-1">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
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
          className="px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-xs disabled:opacity-50"
          onClick={copyWindowMarkdown}
          disabled={state.archiving}
        >
          {state.copied ? 'Copied!' : 'Copy as Markdown'}
        </button>
        <button
          className="px-2 py-0.5 rounded bg-orange-200 hover:bg-orange-300 text-xs disabled:opacity-50"
          onClick={() => handleArchiveWindow(false)}
          disabled={state.archiving}
        >
          {state.archiving ? 'Archiving...' : 'Archive'}
        </button>
        <button
          className="px-2 py-0.5 rounded bg-orange-100 hover:bg-orange-200 text-xs disabled:opacity-50"
          onClick={() => handleArchiveWindow(true)}
          disabled={state.archiving}
        >
          {state.archiving ? 'Archiving...' : 'Archive & Keep Window Open'}
        </button>
      </div>

      {win.items.map((item, itemIdx) =>
        item.type === 'group' ? (
          <div key={itemIdx} className="mt-2">
            <div className="flex items-center gap-1.5 font-medium text-xs text-gray-600 mb-0.5">
              <span style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '3px',
                background: (item.group.color ? GROUP_COLOR_HEX[item.group.color] : null) ?? '#ccc',
                flexShrink: 0,
              }} />
              {!!(item.group.name && dupGroupTitles.has(item.group.name)) && <span>⚠️</span>}
              <span>
                {item.group.name && dupGroupTitles.has(item.group.name)
                  ? `${item.group.name} [DUPLICATE]`
                  : (item.group.name || '(unnamed group)')}
              </span>
            </div>
            <div className="ml-4 space-y-0.5">
              {item.group.tabs.map((tab, tabIdx) => {
                const isDupUrl = tab.url ? dupUrls.has(tab.url) : false;
                return (
                  <div key={tabIdx} className="truncate text-xs">
                    {isDupUrl && <span>⚠️ </span>}
                    <a
                      href={tab.url || '#'}
                      className="text-blue-600 hover:underline"
                      title={tab.url || ''}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.button === 1) return;
                        e.preventDefault();
                        if (tab.id !== undefined) {
                          chrome.tabs.update(tab.id, { active: true });
                          if (chromeWin.id !== undefined) chrome.windows.update(chromeWin.id, { focused: true });
                        }
                      }}
                    >
                      {tab.title || tab.url || '(untitled)'}
                    </a>
                    {isDupUrl && <span> [DUPLICATE]</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div key={itemIdx} className="truncate text-xs">
            {(item.tab.url && dupUrls.has(item.tab.url)) && <span>⚠️ </span>}
            <a
              href={item.tab.url || '#'}
              className="text-blue-600 hover:underline"
              title={item.tab.url || ''}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.button === 1) return;
                e.preventDefault();
                if (item.tab.id !== undefined) {
                  chrome.tabs.update(item.tab.id, { active: true });
                  if (chromeWin.id !== undefined) chrome.windows.update(chromeWin.id, { focused: true });
                }
              }}
            >
              {item.tab.title || item.tab.url || '(untitled)'}
            </a>
            {(item.tab.url && dupUrls.has(item.tab.url)) && <span> [DUPLICATE]</span>}
          </div>
        )
      )}
    </section>
  );
});

interface ArchivedWindowCardProps {
  archived: ArchivedWindow;
}

const ArchivedWindowCard = observer((props: ArchivedWindowCardProps) => {
  const { archived } = props;

  const state = useLocalObservable(() => ({
    isRenaming: false,
    renameValue: '',
    restoring: false,
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
    state.renameValue = archived.name;
    state.isRenaming = true;
  }

  async function commitRename() {
    const newName = state.renameValue.trim();
    if (newName && newName !== archived.name) {
      try {
        await chrome.bookmarks.update(archived.bookmarkFolderId, { title: newName });
        await refresh();
      } catch (error) {
        console.error('Error renaming archived window:', error);
      }
    }
    state.isRenaming = false;
  }

  function cancelRename() {
    state.isRenaming = false;
  }

  async function handleRestoreWindow(keepBookmarks: boolean) {
    try {
      state.restoring = true;
      await background.restoreWindow(archived.bookmarkFolderId, keepBookmarks);
      await refresh();
    } catch (error) {
      console.error('Error restoring window:', error);
    } finally {
      state.restoring = false;
    }
  }

  async function handleCopyMarkdown() {
    await copyMarkdown(windowToMarkdown(archived));
    state.copied = true;
    setTimeout(() => { state.copied = false; }, 1500);
  }

  return (
    <section className="border border-gray-200 rounded p-3 space-y-1">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {state.isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={state.renameValue}
            placeholder="Window name"
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
            title="Click to rename this archived window"
            onClick={startRename}
          >
            {archived.name}
          </h2>
        )}
        <button
          className="px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-xs disabled:opacity-50"
          onClick={handleCopyMarkdown}
          disabled={state.restoring}
        >
          {state.copied ? 'Copied!' : 'Copy as Markdown'}
        </button>
        <button
          className="px-2 py-0.5 rounded bg-green-200 hover:bg-green-300 text-xs disabled:opacity-50"
          onClick={() => handleRestoreWindow(false)}
          disabled={state.restoring}
        >
          {state.restoring ? 'Restoring...' : 'Restore'}
        </button>
        <button
          className="px-2 py-0.5 rounded bg-green-100 hover:bg-green-200 text-xs disabled:opacity-50"
          onClick={() => handleRestoreWindow(true)}
          disabled={state.restoring}
        >
          {state.restoring ? 'Restoring...' : 'Restore & Keep Bookmarks'}
        </button>
      </div>

      {archived.items.map((item, itemIdx) =>
        item.type === 'group' ? (
          <div key={itemIdx} className="mt-2">
            <div className="flex items-center gap-1.5 font-medium text-xs text-gray-600 mb-0.5">
              <span style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '3px',
                background: GROUP_COLOR_HEX[item.group.color ?? 'grey'] ?? '#ccc',
                flexShrink: 0,
              }} />
              <span>{item.group.name || '(unnamed group)'}</span>
            </div>
            <div className="ml-4 space-y-0.5">
              {item.group.tabs.map((tab, tabIdx) => (
                <div key={tabIdx} className="truncate text-xs text-gray-700" title={tab.url}>
                  {tab.title || tab.url || '(untitled)'}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div key={itemIdx} className="truncate text-xs text-gray-700" title={item.tab.url}>
            {item.tab.title || item.tab.url || '(untitled)'}
          </div>
        )
      )}
    </section>
  );
});

const Inventory = observer(() => {
  const state = useLocalObservable(() => ({ exportCopied: false }));

  async function copyAllWindowsMarkdown() {
    await copyMarkdown(windowsToMarkdown(inventoryStore.windows));
    state.exportCopied = true;
    setTimeout(() => { state.exportCopied = false; }, 1500);
  }

  return (
    <div id="inventory" className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
          onClick={copyAllWindowsMarkdown}
        >
          {state.exportCopied ? 'Copied!' : 'Copy as Markdown'}
        </button>
        <button
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
          onClick={() => background.syncAllNameTabs()}
        >
          Sync name tabs
        </button>
      </div>
      {inventoryStore.windows.map((winData) => (
        <ActiveWindow key={winData.chromeWindow.id} win={winData} />
      ))}
    </div>
  );
});

const Archive = observer(() => {
  const state = useLocalObservable(() => ({ exportCopied: false }));

  async function copyAllArchivedWindowsMarkdown() {
    await copyMarkdown(windowsToMarkdown(inventoryStore.archivedWindows));
    state.exportCopied = true;
    setTimeout(() => { state.exportCopied = false; }, 1500);
  }

  return (
    <div id="archive" className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
          onClick={copyAllArchivedWindowsMarkdown}
        >
          {state.exportCopied ? 'Copied!' : 'Copy as Markdown'}
        </button>
        <button
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-xs"
          onClick={() => background.openEdgeFavorites()}
        >
          Open Edge Favorites
        </button>
      </div>

      {inventoryStore.archivedWindows.length === 0 ? (
        <p className="text-xs text-gray-600 italic">No archived windows yet. Use the "Archive" button on active windows to save them.</p>
      ) : (
        inventoryStore.archivedWindows.map((archived) => (
          <ArchivedWindowCard key={archived.bookmarkFolderId} archived={archived} />
        ))
      )}
    </div>
  );
});

const Root = observer(() => {
  useEffect(() => {
    chrome.storage.local.get<LocalStorage>('autoRefresh', (result) => {
      uiStore.setAutoRefresh((result.autoRefresh as boolean | undefined) ?? false);
    });
  }, []);

  function handleAutoRefreshChange(e: React.ChangeEvent<HTMLInputElement>) {
    uiStore.setAutoRefresh(e.target.checked);
    chrome.storage.local.set<LocalStorage>({ autoRefresh: e.target.checked });
  }

  return (
    <div className="p-6 font-sans text-sm">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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
          onClick={() => background.reloadExtension()}
        >
          Reload extension
        </button>
      </div>

      <div className="flex gap-2 mb-4 border-b border-gray-300">
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 ${
            uiStore.activeTab === 'windows'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => uiStore.setActiveTab('windows')}
        >
          Windows
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 ${
            uiStore.activeTab === 'archive'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => uiStore.setActiveTab('archive')}
        >
          Archive
        </button>
      </div>

      {uiStore.activeTab === 'windows' ? (
        <>
          <Summary />
          <Inventory />
        </>
      ) : (
        <Archive />
      )}
    </div>
  );
});

// --- Bind messaging ---

const background = new BackgroundService();

// ── Refresh ──────────────────────────────────────────────────────────────────

async function refresh() {
  await Promise.all([
    refreshWindows(),
    refreshArchive(),
  ]);
}

async function refreshWindows() {
  const [windows] = await Promise.all([
    background.queryActiveWindows(),
  ]);
  inventoryStore.setWindows(windows);
}

async function refreshArchive() {
  const archivedWindows = await background.queryArchivedWindows();
  inventoryStore.setArchivedWindows(archivedWindows);
}

function autoRefreshWindowsIfEnabled() {
  if (uiStore.autoRefresh) refreshWindows();
}

function autoRefreshArchiveIfEnabled() {
  if (uiStore.autoRefresh) refreshArchive();
}

function autoRefreshAllIfEnabled() {
  if (uiStore.autoRefresh) refresh();
}

messaging.onNotification('tabInventoryChanged', autoRefreshWindowsIfEnabled);
messaging.onNotification('archivedWindowsChanged', autoRefreshArchiveIfEnabled);
autorun(autoRefreshAllIfEnabled);

// ── Bind UI ─────────────────────────────────────────────────────────────────

// console.dir(await background.sandbox());

const root = createRoot(document.getElementById('root')!);
root.render(<Root />);

// --- Load initial data ---

refresh();
