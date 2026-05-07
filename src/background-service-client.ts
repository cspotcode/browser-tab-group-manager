import type {IBackgroundService} from './background';
import * as messaging from './messaging';
import type { ActiveWindow, ArchivedWindow } from './window';
export class BackgroundService implements IBackgroundService {
  queryActiveWindows(): Promise<ActiveWindow[]> {
    return messaging.send<IBackgroundService, 'queryActiveWindows'>('queryActiveWindows');
  }
  getSerializedWindowNames(): Promise<messaging.SerializedMap<number, string>> {
    return messaging.send<IBackgroundService, 'getSerializedWindowNames'>('getSerializedWindowNames');
  }
  setWindowName(windowId: number, name: string | undefined): Promise<void> {
    return messaging.send<IBackgroundService, 'setWindowName'>('setWindowName', windowId, name);
  }
  syncAllNameTabs(): Promise<void> {
    return messaging.send<IBackgroundService, 'syncAllNameTabs'>('syncAllNameTabs');
  }
  reloadExtension(): Promise<void> {
    return messaging.send<IBackgroundService, 'reloadExtension'>('reloadExtension');
  }
  ensureOffscreen(): Promise<void> {
    return messaging.send<IBackgroundService, 'ensureOffscreen'>('ensureOffscreen');
  }
  sandbox(): Promise<string> {
    return messaging.send<IBackgroundService, 'sandbox'>('sandbox');
  }
  queryArchivedWindows(): Promise<ArchivedWindow[]> {
    return messaging.send<IBackgroundService, 'queryArchivedWindows'>('queryArchivedWindows');
  }
  archiveWindow(windowId: number, keepWindow: boolean, overwriteExisting: boolean = false): Promise<void> {
    return messaging.send<IBackgroundService, 'archiveWindow'>('archiveWindow', windowId, keepWindow, overwriteExisting);
  }
  restoreWindow(archivedWindowId: string, keepBookmarks: boolean): Promise<void> {
    return messaging.send<IBackgroundService, 'restoreWindow'>('restoreWindow', archivedWindowId, keepBookmarks);
  }
  openEdgeFavorites(): Promise<void> {
    return messaging.send<IBackgroundService, 'openEdgeFavorites'>('openEdgeFavorites');
  }
}