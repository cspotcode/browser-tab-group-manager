import * as backgroundTypes from './background';
import * as messaging from './messaging';
export class BackgroundService implements backgroundTypes.BackgroundService {
  reloadExtension(): Promise<void> {
    return messaging.send<backgroundTypes.BackgroundService, 'reloadExtension'>('reloadExtension');
  }
  getTabInventory() { return messaging.send<backgroundTypes.BackgroundService, 'getTabInventory'>('getTabInventory'); }
  getWindowNames() { return messaging.send<backgroundTypes.BackgroundService, 'getWindowNames'>('getWindowNames'); }
  setWindowName(...args: Parameters<backgroundTypes.BackgroundService['setWindowName']>) { return messaging.send<backgroundTypes.BackgroundService, 'setWindowName'>('setWindowName', ...args); }
  ensureOffscreen() { return messaging.send<backgroundTypes.BackgroundService, 'ensureOffscreen'>('ensureOffscreen'); }
  sandbox() { return messaging.send<backgroundTypes.BackgroundService, 'sandbox'>('sandbox'); }
}