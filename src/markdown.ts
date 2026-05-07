import { GROUP_COLOR_EMOJI } from './tab-group-colors';
import { windowDisplayName, type SharedWindow } from './window';

export function windowToMarkdown(win: SharedWindow): string {
  const lines: string[] = [];
  const displayName = windowDisplayName(win);
  lines.push(`# ${displayName}`);
  lines.push('');

  for (const item of win.items) {
    if (item.type === 'group') {
      const { group } = item;
      const emoji = (group.color ? GROUP_COLOR_EMOJI[group.color] : null) ?? '⚪';
      lines.push(`- ${emoji} ${group.name || '(unnamed group)'}`);
      for (const tab of group.tabs) {
        lines.push(`  - [${tab.title || tab.url || '(untitled)'}](${tab.url || ''})`);
      }
    } else {
      const { tab } = item;
      lines.push(`- [${tab.title || tab.url || '(untitled)'}](${tab.url || ''})`);
    }
  }

  return lines.join('\n').trimEnd();
}

export function windowsToMarkdown(windows: SharedWindow[]): string {
  return windows.map(windowToMarkdown).join('\n\n');
}

export async function copyMarkdown(markdown: string): Promise<void> {
  await navigator.clipboard.writeText(markdown);
}
