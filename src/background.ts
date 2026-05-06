// Background service worker
import * as messaging from './messaging';

// --- types ---

export type WindowEntry = {
  window: chrome.windows.Window;
  tabs: chrome.tabs.Tab[];
  groups: chrome.tabGroups.TabGroup[];
};

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

async function getTabInventory(): Promise<WindowEntry[]> {
  const [windows, allTabs, allGroups] = await Promise.all([
    chrome.windows.getAll(),
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
  ]);

  return windows.map((win) => {
    const tabs = allTabs.filter((t) => t.windowId === win.id);
    const groups = allGroups.filter((g) => g.windowId === win.id);
    return { window: win, tabs, groups };
  });
}

async function getWindowNames(): Promise<messaging.SerializedMap<number, string>> {
  const result = await chrome.storage.local.get('windowNames');
  return (result.windowNames as messaging.SerializedMap<number, string>) ?? [];
}

async function setWindowName(windowId: number, name: string | null): Promise<void> {
  const names = messaging.deserializeMap(await getWindowNames());
  if (name === null || name.trim() === '') {
    names.delete(windowId);
    await chrome.storage.local.set({ windowNames: messaging.serializeMap(names) });
    await removeNameTab(windowId);
  } else {
    const trimmed = name.trim();
    names.set(windowId, trimmed);
    await chrome.storage.local.set({ windowNames: messaging.serializeMap(names) });
    await syncNameTab(windowId, trimmed);
  }
}

async function syncAllNameTabs(): Promise<void> {
  const names = messaging.deserializeMap(await getWindowNames());
  await Promise.all(
    Array.from(names.entries()).map(([windowId, name]) => syncNameTab(windowId, name))
  );
}

async function reloadExtension(): Promise<void> {
  await chrome.storage.local.set({ reopenTabInventory: true });
  chrome.runtime.reload();
}

async function sandbox(): Promise<string> {
  // use this for quick message-passing debugging
  return 'Hello world!';
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

// --- startup init ---

// On startup, reopen tab inventory if flagged before reload
chrome.storage.local.get('reopenTabInventory', (result) => {
  if (result.reopenTabInventory) {
    chrome.tabs.create({ url: chrome.runtime.getURL('tab-inventory.html') });
    chrome.storage.local.remove('reopenTabInventory');
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
    getWindowNames().then((s) => messaging.deserializeMap(s)),
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
    await chrome.storage.local.set({ windowNames: messaging.serializeMap(storedNames) });
  }
}

recoverWindowNamesFromTabs();

// --- Bind messaging ---

const messageListeners = { getTabInventory, getWindowNames, setWindowName, syncAllNameTabs, reloadExtension, ensureOffscreen, sandbox };
export type BackgroundService = typeof messageListeners;
messaging.bindListeners(messageListeners);

// Register for all events that affect the tab inventory
function broadcastInventoryChanged() {
  messaging.sendNotification('tabInventoryChanged');
}
