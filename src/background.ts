// Background service worker
import * as messaging from './messaging';

// --- types ---

export type WindowEntry = {
  window: chrome.windows.Window;
  tabs: chrome.tabs.Tab[];
  groups: chrome.tabGroups.TabGroup[];
};

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
  } else {
    names.set(windowId, name.trim());
  }
  await chrome.storage.local.set({ windowNames: messaging.serializeMap(names) });
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

// --- Bind messaging ---

const messageListeners = { getTabInventory, getWindowNames, setWindowName, reloadExtension, ensureOffscreen, sandbox };
export type BackgroundService = typeof messageListeners;
messaging.bindListeners(messageListeners);

// Register for all events that affect the tab inventory
function broadcastInventoryChanged() {
  messaging.sendNotification('tabInventoryChanged');
}
