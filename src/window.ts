// Shared types for tab inventory, windows, and archived windows

import type { AllowedColor } from "./tab-group-colors";

export interface TabInfo {
  title: string;
  url: string;
  id?: number;
}

export interface TabGroupInfo {
  name: string;
  id?: number;
  color?: AllowedColor;
  tabs: TabInfo[];
}

export type WindowItem =
  | { type: 'group'; group: TabGroupInfo }
  | { type: 'ungroupedTab'; tab: TabInfo };

/** Base type shared between active and archived windows. */
export interface SharedWindow {
  // active windows always have an ID, not always a name.
  // archived windows always have a name, never an ID.
  // Various markdown and UI logic references both fields, so they are both declared, both optional.
  id: number | undefined;
  name: string | undefined;
  items: WindowItem[];
}

export interface ArchivedWindow extends SharedWindow {
  // Re-declare to narrow the SharedWindow type to string, never undefined
  name: string;
  bookmarkFolderId: string;
}

export interface ActiveWindow extends SharedWindow {
  // Re-declare to narrow the SharedWindow type to string, never undefined
  id: number;
  /** The underlying chrome window object. */
  chromeWindow: chrome.windows.Window;
}

export function windowDisplayName(win: SharedWindow): string {
  if(win.id && win.name) {
    return `${win.name} (Window ${win.id})`;
  }
  if(win.id) {
    return `Window ${win.id}`;
  }
  return win.name!;
}
