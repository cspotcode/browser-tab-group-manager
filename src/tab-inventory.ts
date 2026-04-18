// Tab inventory page

const GROUP_COLOR_EMOJI: Record<string, string> = {
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

const GROUP_COLOR_HEX: Record<string, string> = {
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

function makeGroupSwatch(color: string): HTMLElement {
  const swatch = document.createElement('span');
  swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;background:${GROUP_COLOR_HEX[color] ?? '#ccc'};flex-shrink:0`;
  return swatch;
}

interface WindowData {
  window: chrome.windows.Window;
  tabs: chrome.tabs.Tab[];
  groups: chrome.tabGroups.TabGroup[];
}

let windowNames: Record<string, string> = {};

function windowDisplayName(win: chrome.windows.Window): string {
  const custom = windowNames[String(win.id)];
  if (custom) return `${custom} (Window ${win.id})`;
  return `Window ${win.id}`;
}

function renderSummary(inventory: WindowData[]) {
  const summary = document.getElementById('summary')!;
  summary.innerHTML = '';

  for (const { window: win } of inventory) {
    const link = document.createElement('a');
    link.href = `#window-${win.id}`;
    link.className = 'block text-blue-600 hover:underline text-xs';
    link.textContent = win.focused
      ? `${windowDisplayName(win)} (focused)`
      : windowDisplayName(win);
    summary.appendChild(link);
  }
}

function buildDuplicateSets(inventory: WindowData[]): { urls: Set<string>; groupTitles: Set<string> } {
  const urlCounts = new Map<string, number>();
  const groupTitleCounts = new Map<string, number>();

  for (const { tabs, groups } of inventory) {
    for (const tab of tabs) {
      if (tab.url) urlCounts.set(tab.url, (urlCounts.get(tab.url) ?? 0) + 1);
    }
    for (const group of groups) {
      if (group.title) groupTitleCounts.set(group.title, (groupTitleCounts.get(group.title) ?? 0) + 1);
    }
  }

  return {
    urls: new Set([...urlCounts.entries()].filter(([, n]) => n > 1).map(([u]) => u)),
    groupTitles: new Set([...groupTitleCounts.entries()].filter(([, n]) => n > 1).map(([t]) => t)),
  };
}

function renderInventory(inventory: WindowData[]) {
  const container = document.getElementById('inventory')!;
  container.innerHTML = '';

  const { urls: dupUrls, groupTitles: dupGroupTitles } = buildDuplicateSets(inventory);

  for (const { window: win, tabs, groups } of inventory) {
    const section = document.createElement('section');
    section.id = `window-${win.id}`;
    section.className = 'border border-gray-200 rounded p-3 space-y-1';

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-center gap-2 mb-2';

    const title = document.createElement('h2');
    title.className = 'font-semibold text-base cursor-pointer hover:text-blue-600';
    title.title = 'Click to set a custom name for this window';
    title.textContent = win.focused
      ? `${windowDisplayName(win)} (focused)`
      : windowDisplayName(win);

    title.addEventListener('click', () => startRename(win.id!, title));
    titleRow.appendChild(title);
    section.appendChild(titleRow);

    const groupMap = new Map(groups.map((g) => [g.id, g]));
    const renderedGroups = new Set<number>();

    for (const tab of tabs) {
      if (tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const group = groupMap.get(tab.groupId);
        if (group && !renderedGroups.has(group.id)) {
          renderedGroups.add(group.id);
          const groupEl = document.createElement('div');
          groupEl.className = 'mt-2 mb-0.5 flex items-center gap-1.5 font-medium text-xs text-gray-600';
          const isDupGroup = group.title && dupGroupTitles.has(group.title);
          groupEl.appendChild(makeGroupSwatch(group.color));
          if (isDupGroup) {
            const warn = document.createElement('span');
            warn.textContent = '⚠️';
            groupEl.appendChild(warn);
          }
          const label = document.createElement('span');
          label.textContent = isDupGroup
            ? `${group.title} [DUPLICATE]`
            : (group.title ?? '(unnamed group)');
          groupEl.appendChild(label);
          section.appendChild(groupEl);
        }
        section.appendChild(renderTab(tab, true, dupUrls));
      } else {
        section.appendChild(renderTab(tab, false, dupUrls));
      }
    }

    container.appendChild(section);
  }
}

function startRename(windowId: number, titleEl: HTMLElement) {
  const currentCustom = windowNames[String(windowId)] ?? '';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentCustom;
  input.placeholder = 'Custom name (blank to clear)';
  input.className = 'border border-blue-400 rounded px-2 py-0.5 text-sm font-semibold w-64 outline-none';

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const newName = input.value.trim() || null;
    await chrome.runtime.sendMessage({ type: 'SET_WINDOW_NAME', windowId, name: newName });
    if (newName) {
      windowNames[String(windowId)] = newName;
    } else {
      delete windowNames[String(windowId)];
    }
    // Restore the title element with updated text
    const focused = titleEl.textContent?.includes('(focused)') ?? false;
    titleEl.textContent = focused
      ? `${windowDisplayName({ id: windowId } as chrome.windows.Window)} (focused)`
      : windowDisplayName({ id: windowId } as chrome.windows.Window);
    input.replaceWith(titleEl);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = currentCustom;
      input.blur();
    }
  });
}

function renderTab(tab: chrome.tabs.Tab, indented: boolean, dupUrls: Set<string> = new Set()): HTMLElement {
  const el = document.createElement('div');
  el.className = indented ? 'ml-4 truncate text-xs' : 'truncate text-xs';

  const link = document.createElement('a');
  link.href = tab.url ?? '#';
  link.className = 'text-blue-600 hover:underline';
  link.title = tab.url ?? '';
  const isDupUrl = tab.url ? dupUrls.has(tab.url) : false;
  link.textContent = isDupUrl
    ? `⚠️ ${tab.title ?? tab.url ?? '(untitled)'} [DUPLICATE]`
    : (tab.title ?? tab.url ?? '(untitled)');

  // Left-click focuses the tab; ctrl/middle-click and right-click work naturally via href
  link.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.button === 1) return;
    e.preventDefault();
    if (tab.id !== undefined) {
      chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    }
  });

  el.appendChild(link);
  return el;
}

async function refresh() {
  const [inventoryRes, namesRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_TAB_INVENTORY' }),
    chrome.runtime.sendMessage({ type: 'GET_WINDOW_NAMES' }),
  ]);
  windowNames = namesRes.names;
  lastInventory = inventoryRes.data;
  renderSummary(lastInventory);
  renderInventory(lastInventory);
}

function toMarkdown(inventory: WindowData[]): string {
  const { urls: dupUrls, groupTitles: dupGroupTitles } = buildDuplicateSets(inventory);
  const lines: string[] = [];

  for (const { window: win, tabs, groups } of inventory) {
    lines.push(`# ${windowDisplayName(win)}`);
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
      const title = isDupUrl
        ? `⚠️ ${tab.title ?? tab.url ?? '(untitled)'} [DUPLICATE]`
        : (tab.title ?? tab.url ?? '(untitled)');
      const indent = inGroup ? '  ' : '';
      lines.push(`${indent}- [${title}](${tab.url ?? ''})`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

let lastInventory: WindowData[] = [];

const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
exportBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(toMarkdown(lastInventory));
  const original = exportBtn.textContent;
  exportBtn.textContent = 'Copied!';
  setTimeout(() => { exportBtn.textContent = original; }, 1500);
});

document.getElementById('refresh-btn')!.addEventListener('click', refresh);

refresh();
