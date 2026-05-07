// Background service worker
import type { LocalStorage } from './local-storage';
import * as messaging from './messaging';
import { parseGroupNameWithColor, formatGroupNameWithColor } from './tab-group-colors';
import type { ActiveWindow, TabInfo, ArchivedWindow, WindowItem, TabGroupInfo } from './window';

if (typeof window !== 'undefined' || !(self instanceof ServiceWorkerGlobalScope)) {
  throw new Error("This script must be run within a Service Worker context.");
}

// --- window-name anchor tab helpers ---

const WINDOW_NAME_PAGE = 'window-name.html';

function windowNameTabUrl(windowId: number, name: string): string {
  const payload = JSON.stringify({ name, id: windowId });
  return chrome.runtime.getURL(`${WINDOW_NAME_PAGE}#${encodeURIComponent(payload)}`);
}

/** Parse the name out of a window-name anchor tab URL. Returns null if not a name tab. */
function parseWindowNameTab(url: string): { name: string } | null {
  const base = chrome.runtime.getURL(WINDOW_NAME_PAGE);
  if (!url.startsWith(base)) return null;
  const hash = url.slice(base.length);
  if (!hash.startsWith('#')) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(hash.slice(1)));
    if (typeof payload?.name === 'string') return { name: payload.name };
  } catch {
    // malformed hash — ignore
  }
  return null;
}

/** Find the existing name anchor tab in a window, if any. */
async function findNameTab(windowId: number): Promise<chrome.tabs.Tab | null> {
  const base = chrome.runtime.getURL(WINDOW_NAME_PAGE);
  const tabs = await chrome.tabs.query({ windowId, url: base + '*' });
  return tabs[0] ?? null;
}

/**
 * Ensure the window has a pinned name anchor tab with the correct URL.
 * Creates one if absent, updates the URL if the name changed.
 */
async function syncNameTab(windowId: number, name: string): Promise<void> {
  const url = windowNameTabUrl(windowId, name);
  const existing = await findNameTab(windowId);
  if (existing) {
    if (existing.url !== url) {
      await chrome.tabs.update(existing.id!, { url });
    }
    if (!existing.pinned) {
      await chrome.tabs.update(existing.id!, { pinned: true });
    }
  } else {
    await chrome.tabs.create({ windowId, url, pinned: true, index: 0, active: false });
  }
}

/** Remove the name anchor tab from a window (used when the name is cleared). */
async function removeNameTab(windowId: number): Promise<void> {
  const existing = await findNameTab(windowId);
  if (existing?.id != null) {
    await chrome.tabs.remove(existing.id);
  }
}

// --- service endpoints: message listeners ---

async function ensureOffscreen(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
    justification: 'File System Access API requires a window context',
  });
}

async function queryActiveWindows(): Promise<ActiveWindow[]> {
  const [chromeWindows, allChromeTabs, allChromeGroups, namesSerialized] = await Promise.all([
    chrome.windows.getAll(),
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    getSerializedWindowNames(),
  ]);
  const names = messaging.deserializeMap(namesSerialized);

  return chromeWindows.map((chromeWindow) => {
    const chromeTabs = allChromeTabs.filter((t) => t.windowId === chromeWindow.id);
    const chromeGroups = allChromeGroups.filter((g) => g.windowId === chromeWindow.id);
    const chromeGroupsMap = new Map(chromeGroups.map((g) => [g.id, g]));
    const groupInfos = new Map<number, TabGroupInfo>();
    const items: WindowItem[] = [];

    for (const tab of chromeTabs) {
      const tabInfo: TabInfo = {
        title: tab.title ?? tab.url ?? '(untitled)',
        url: tab.url ?? '',
        id: tab.id,
      };

      const inGroup = tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
      if (inGroup) {
        let groupInfo = groupInfos.get(tab.groupId);
        if(!groupInfo) {
          const chromeGroup = chromeGroupsMap.get(tab.groupId!)!;
          groupInfo = {
            name: chromeGroup.title ?? '',
            id: chromeGroup.id,
            color: chromeGroup.color,
            tabs: [],
          };
          groupInfos.set(tab.groupId, groupInfo);
          items.push({
            type: 'group',
            group: groupInfo
          });
        }
        groupInfo.tabs.push(tabInfo);
      } else {
        items.push({
          type: 'ungroupedTab',
          tab: tabInfo
        });
      }
    }

    // Always have an ID here; would only be absent if we queried the sessions API
    const windowId = chromeWindow.id!;

    const name = names.get(windowId);

    const ret: ActiveWindow = {
      chromeWindow,
      id: windowId,
      name,
      items
    };

    return ret;
  });
}

/** For calls within background.ts which can access a deserialized value directly */
async function getWindowNames(): Promise<Map<number, string>> {
  const result = await chrome.storage.local.get<LocalStorage>('windowNames');
  return messaging.deserializeMap(result.windowNames as messaging.SerializedMap<number, string>);
}
/** For calls from outside background.ts which need the serialized value */
async function getSerializedWindowNames(): Promise<messaging.SerializedMap<number, string>> {
  const result = await chrome.storage.local.get<LocalStorage>('windowNames');
  return result.windowNames ?? [];
}

async function setWindowName(windowId: number, name: string | undefined): Promise<void> {
  const names = await getWindowNames();
  if (name == null || name.trim() === '') {
    names.delete(windowId);
    await chrome.storage.local.set<LocalStorage>({ windowNames: messaging.serializeMap(names) });
    await removeNameTab(windowId);
  } else {
    const trimmed = name.trim();
    names.set(windowId, trimmed);
    await chrome.storage.local.set<LocalStorage>({ windowNames: messaging.serializeMap(names) });
    await syncNameTab(windowId, trimmed);
  }
}

async function syncAllNameTabs(): Promise<void> {
  const names = await getWindowNames();
  await Promise.all(
    Array.from(names.entries()).map(([windowId, name]) => syncNameTab(windowId, name))
  );
}

async function reloadExtension(): Promise<void> {
  await chrome.storage.local.set<LocalStorage>({ reopenTabInventory: true });
  chrome.runtime.reload();
}

async function sandbox(): Promise<string> {
  // use this for quick message-passing debugging
  return 'Hello world!';
}

// --- Archived windows / bookmarks management ---

const ARCHIVED_WINDOWS_FOLDER_NAME = 'Archived Windows';

/** Find or create the "Archived Windows" root folder in bookmarks. */
async function getOrCreateArchivedWindowsFolder(): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const trees = await chrome.bookmarks.getTree();
  const root = trees[0];
  if (!root) throw new Error('Bookmarks root not found');

  async function findFolder(node: chrome.bookmarks.BookmarkTreeNode): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
    if (node.children) {
      for (const child of node.children) {
        if (child.title === ARCHIVED_WINDOWS_FOLDER_NAME && !child.url) {
          return child;
        }
        const found = await findFolder(child);
        if (found) return found;
      }
    }
    return null;
  }

  const existing = await findFolder(root);
  if (existing) return existing;

  // Create in root (typically "Other Bookmarks")
  const created = await chrome.bookmarks.create({
    title: ARCHIVED_WINDOWS_FOLDER_NAME,
  });
  return created;
}

/** Query archived windows from bookmarks. */
async function queryArchivedWindows(): Promise<ArchivedWindow[]> {
  try {
    const archivedFolder = await getOrCreateArchivedWindowsFolder();
    if (!archivedFolder.children) return [];

    const result: ArchivedWindow[] = [];

    for (const windowFolder of archivedFolder.children) {
      if (!windowFolder.children || windowFolder.url) continue;

      result.push(parseArchivedWindowFromBookmarks(windowFolder));
    }

    return result;
  } catch (error) {
    console.error('Error querying archived windows:', error);
    return [];
  }
}

/**
 * @param windowFolder *Must* be a folder tree node. Caller should validate this.
 */
function parseArchivedWindowFromBookmarks(windowFolder: chrome.bookmarks.BookmarkTreeNode): ArchivedWindow {
      const items: WindowItem[] = [];

      for (const item of windowFolder.children!) {
        if (item.url) {
          // Ungrouped tab (bookmark)
          items.push({
            type: 'ungroupedTab',
            tab: {
              title: item.title ?? '(untitled)',
              url: item.url,
            },
          });
        } else if (item.children) {
          // Tab group (folder with bookmarks)
          const { color, name } = parseGroupNameWithColor(item.title ?? '');
          const groupTabs: TabInfo[] = item.children
            .filter((b): b is chrome.bookmarks.BookmarkTreeNode => b !== undefined && b.url !== undefined)
            .map((b) => ({
              title: b.title ?? '(untitled)',
              url: b.url!,
            }));

          items.push({
            type: 'group',
            group: {
              name,
              color,
              tabs: groupTabs,
            },
          });
        }
      }

      const ret: ArchivedWindow = {
        bookmarkFolderId: windowFolder.id,
        id: undefined,
        name: windowFolder.title ?? 'Unnamed Window',
        items,
      };
      return ret;
}

/** Check if an archive with the given name already exists. */
async function findArchivedWindowByName(windowName: string): Promise<chrome.bookmarks.BookmarkTreeNode | null> {
  try {
    const archivedFolder = await getOrCreateArchivedWindowsFolder();
    if (!archivedFolder.children) return null;

    for (const child of archivedFolder.children) {
      if (child.title === windowName && !child.url) {
        return child;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Archive a window: create bookmarks and optionally close the window. */
async function archiveWindow(windowId: number, keepWindow: boolean, overwriteExisting: boolean = false): Promise<void> {
  try {
    const [allTabs, allGroups, names, windows] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId }),
      getWindowNames(),
      chrome.windows.getAll(),
    ]);

    const window = windows.find((w) => w.id === windowId);
    if (!window || window.id === undefined) throw new Error(`Window ${windowId} not found or invalid`);

    const windowName = names.get(windowId) ?? `Window ${windowId}`;

    const archivedFolder = await getOrCreateArchivedWindowsFolder();

    let windowFolder: chrome.bookmarks.BookmarkTreeNode;
    const existing = await findArchivedWindowByName(windowName);

    if (existing) {
      if (!overwriteExisting) {
        // TODO throwing an error in background.ts is not helpful because the user doesn't see this, they only observe a timeout.
        throw new Error(`ARCHIVE_EXISTS:${windowName}`);
      }
      // Remove existing archive before creating new one
      await chrome.bookmarks.removeTree(existing.id);
    }

    windowFolder = await chrome.bookmarks.create({
      parentId: archivedFolder.id,
      title: windowName,
    });

    const groupMap = new Map(allGroups.map((g) => [g.id, g]));
    const renderedGroups = new Set<number>();
    const groupFolderMap = new Map<number, string>();

    // Process tabs in order to preserve interleaving of groups and ungrouped tabs
    for (const tab of allTabs) {
      const inGroup =
        tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
      const group = inGroup ? groupMap.get(tab.groupId!) : undefined;

      if (inGroup && group && !renderedGroups.has(group.id)) {
        // First encounter with this group — create the group folder
        renderedGroups.add(group.id);
        const groupTitle = formatGroupNameWithColor(group.title ?? '(unnamed group)', group.color);
        const groupFolder = await chrome.bookmarks.create({
          parentId: windowFolder.id,
          title: groupTitle,
        });
        groupFolderMap.set(group.id, groupFolder.id);
      }

      // Create the tab bookmark in the appropriate parent
      const tabTitle = tab.title ?? tab.url ?? '(untitled)';
      const tabUrl = tab.url ?? '';
      const parentId = inGroup && groupFolderMap.has(tab.groupId!)
        ? groupFolderMap.get(tab.groupId!)!
        : windowFolder.id;

      await chrome.bookmarks.create({
        parentId,
        title: tabTitle,
        url: tabUrl,
      });
    }

    // Close window if not keeping it
    if (!keepWindow) {
      await chrome.windows.remove(windowId);
    }

    broadcastArchivedWindowsChanged();
  } catch (error) {
    // TODO see earlier TODO: doing this in background.ts is not helpful.
    console.error('Error archiving window:', error);
    throw error;
  }
}

let restorationIndex = 0;
/** Restore an archived window: create new window from bookmarks and optionally delete bookmarks. */
async function restoreWindow(archivedWindowId: string, keepBookmarks: boolean): Promise<void> {
  console.dir({restorationIndex});
  restorationIndex++;
  try {
    const [windowFolder] = await chrome.bookmarks.getSubTree(archivedWindowId);
    if (!windowFolder || windowFolder.url || !windowFolder.children) {
      throw new Error(`Archived window folder ${archivedWindowId} not found or invalid`);
    }

    const archivedWindow = parseArchivedWindowFromBookmarks(windowFolder);
    console.dir(archivedWindow);

    const urls: string[] = [];
    interface RestorationGroup {
      group: TabGroupInfo;
      tabIndices: number[];
    }
    const rgroups: Array<RestorationGroup> = [];

    // First pass: collect all tabs and determine structure
    let tabIndex = 0;
    for (const item of archivedWindow.items) {
      if (item.type === 'ungroupedTab') {
        // Ungrouped tab
        urls.push(item.tab.url);
        tabIndex++;
      } else {
        // Tab group
        const rgroup: RestorationGroup = {
          group: item.group,
          tabIndices: []
        };
        rgroups.push(rgroup);

        for (const tab of item.group.tabs) {
          if (tab.url) {
            urls.push(tab.url);
            rgroup.tabIndices.push(tabIndex);
            tabIndex++;
          }
        }
      }
    }

    // Create window with all tabs in correct order, ungrouped
    const newWindow = await chrome.windows.create({ url: urls, focused: true });
    console.dir({newWindow: {id: newWindow!.id}});
    const createdTabs = newWindow!.tabs ?? [];

    // Create tab groups
    for (const group of rgroups) {
      const tabIds = group.tabIndices
        .map((idx) => createdTabs[idx]?.id)
        .filter((id): id is number => id !== undefined);

      if (tabIds.length > 0) {
        const groupId = await chrome.tabs.group({
          createProperties: {
            windowId: newWindow!.id
          },
          // chrome.tabs.group declares types for array of at least 1 element. Annoying...
          tabIds: tabIds as [number, ...number[]]
        });
        await chrome.tabGroups.update(groupId, {
          title: group.group.name,
          color: group.group.color,
        });
      }
    }

    // Delete archived bookmarks if not keeping them
    if (!keepBookmarks) {
      await chrome.bookmarks.removeTree(archivedWindowId);
    }

    broadcastArchivedWindowsChanged();
  } catch (error) {
    console.error('Error restoring window:', error);
    throw error;
  }
}

// --- bind to all tab change events ---

chrome.tabs.onCreated.addListener(broadcastInventoryChanged);
chrome.tabs.onRemoved.addListener(broadcastInventoryChanged);
chrome.tabs.onUpdated.addListener(broadcastInventoryChanged);
chrome.tabs.onMoved.addListener(broadcastInventoryChanged);
chrome.tabs.onAttached.addListener(broadcastInventoryChanged);
chrome.tabs.onDetached.addListener(broadcastInventoryChanged);
chrome.tabGroups.onCreated.addListener(broadcastInventoryChanged);
chrome.tabGroups.onRemoved.addListener(broadcastInventoryChanged);
chrome.tabGroups.onUpdated.addListener(broadcastInventoryChanged);
chrome.windows.onCreated.addListener(broadcastInventoryChanged);
chrome.windows.onRemoved.addListener(broadcastInventoryChanged);
chrome.windows.onFocusChanged.addListener(broadcastInventoryChanged);

async function openEdgeFavorites(): Promise<void> {
  await chrome.tabs.create({ url: 'edge://favorites' });
}

// --- bind to bookmark change events for archived windows ---

async function isArchivedWindowsBookmark(bookmarkId: string): Promise<boolean> {
  try {
    const [node] = await chrome.bookmarks.getSubTree(bookmarkId);
    if (!node) return false;

    // Check if the node is under the archived windows folder
    const archivedFolder = await getOrCreateArchivedWindowsFolder();
    if (node.parentId === archivedFolder.id) return true;

    return false;
  } catch {
    return false;
  }
}

chrome.bookmarks.onCreated.addListener(async (id) => {
  if (await isArchivedWindowsBookmark(id)) {
    broadcastArchivedWindowsChanged();
  }
});

chrome.bookmarks.onRemoved.addListener(async () => {
  // Always broadcast on bookmark removal since we can't reliably check after deletion
  broadcastArchivedWindowsChanged();
});

chrome.bookmarks.onChanged.addListener(async (id) => {
  if (await isArchivedWindowsBookmark(id)) {
    broadcastArchivedWindowsChanged();
  }
});

// --- startup init ---

// On startup, reopen tab inventory if flagged before reload
chrome.storage.local.get<LocalStorage>('reopenTabInventory', (result) => {
  if (result.reopenTabInventory) {
    chrome.tabs.create({ url: chrome.runtime.getURL('tab-inventory.html') });
    chrome.storage.local.remove<LocalStorage>('reopenTabInventory');
  }
});

/**
 * On startup, scan all windows for name anchor tabs.
 * This recovers names when Chrome reassigns window IDs (e.g. after restart).
 * For any window whose ID isn't in storage but has a name tab, we store the
 * recovered name under the new ID.
 */
async function recoverWindowNamesFromTabs(): Promise<void> {
  const [windows, allTabs, storedNames] = await Promise.all([
    chrome.windows.getAll(),
    chrome.tabs.query({}),
    getSerializedWindowNames().then((s) => messaging.deserializeMap(s)),
  ]);

  let changed = false;
  for (const win of windows) {
    if (win.id == null) continue;
    if (storedNames.has(win.id)) continue; // already known — no recovery needed

    const nameTabs = allTabs.filter(
      (t) => t.windowId === win.id && t.url != null && parseWindowNameTab(t.url) !== null
    );
    if (nameTabs.length === 0) continue;

    const parsed = parseWindowNameTab(nameTabs[0]!.url!);
    if (parsed) {
      storedNames.set(win.id, parsed.name);
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set<LocalStorage>({ windowNames: messaging.serializeMap(storedNames) });
  }
}

recoverWindowNamesFromTabs();

// --- Bind messaging ---

const messageListeners = {
  queryActiveWindows, queryArchivedWindows,
  getSerializedWindowNames, setWindowName,
  syncAllNameTabs, reloadExtension, ensureOffscreen, 
  archiveWindow, restoreWindow,
  openEdgeFavorites,
  sandbox,
};
export type IBackgroundService = typeof messageListeners;
messaging.bindListeners(messageListeners);

// Register for all events that affect the tab inventory
function broadcastInventoryChanged() {
  messaging.sendNotification('tabInventoryChanged');
}

function broadcastArchivedWindowsChanged() {
  messaging.sendNotification('archivedWindowsChanged');
}
