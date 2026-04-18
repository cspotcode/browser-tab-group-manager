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

// On startup, open tab inventory
chrome.tabs.create({ url: chrome.runtime.getURL('tab-inventory.html') });

// On startup, reopen any tab that was open when reload was triggered
chrome.storage.session.get('reopenUrl', (result) => {
  if (result.reopenUrl) {
    chrome.tabs.create({ url: result.reopenUrl });
    chrome.storage.session.remove('reopenUrl');
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument().then(() => sendResponse());
    return true;
  }

  if (message.type === 'REOPEN_AFTER_RELOAD') {
    chrome.storage.session.set({ reopenUrl: message.url }, () => sendResponse());
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
});

export {};
