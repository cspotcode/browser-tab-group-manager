// Background service worker

async function ensureOffscreenDocument() {
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

async function getTabInventory() {
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

async function getWindowNames(): Promise<Record<string, string>> {
  const result = await chrome.storage.local.get('windowNames');
  return result.windowNames ?? {};
}

async function setWindowName(windowId: number, name: string | null): Promise<void> {
  const names = await getWindowNames();
  if (name === null || name.trim() === '') {
    delete names[String(windowId)];
  } else {
    names[String(windowId)] = name.trim();
  }
  await chrome.storage.local.set({ windowNames: names });
}

function broadcastInventoryChanged() {
  chrome.runtime.sendMessage({ type: 'TAB_INVENTORY_CHANGED' }).catch(() => {
    // No listeners open — ignore
  });
}

// Register for all events that affect the tab inventory
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

// On startup, reopen tab inventory if flagged before reload
chrome.storage.local.get('reopenTabInventory', (result) => {
  if (result.reopenTabInventory) {
    chrome.tabs.create({ url: chrome.runtime.getURL('tab-inventory.html') });
    chrome.storage.local.remove('reopenTabInventory');
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument().then(() => sendResponse());
    return true;
  }

  if (message.type === 'GET_TAB_INVENTORY') {
    getTabInventory().then((data) => sendResponse({ data }));
    return true;
  }

  if (message.type === 'GET_WINDOW_NAMES') {
    getWindowNames().then((names) => sendResponse({ names }));
    return true;
  }

  if (message.type === 'SET_WINDOW_NAME') {
    setWindowName(message.windowId, message.name).then(() => sendResponse());
    return true;
  }

  if (message.type === 'RELOAD_EXTENSION') {
    chrome.storage.local.set({ reopenTabInventory: true }, () => {
      chrome.runtime.reload();
    });
    return false;
  }
});

export {};
