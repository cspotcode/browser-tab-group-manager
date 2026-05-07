import * as messaging from './messaging';

/**
 * Describes all data we store in chrome.storage.local.
 * Used in generic signatures for chrome.storage.local.get and .set to ensure
 * consistency.
 */
export interface LocalStorage {
    windowNames?: messaging.SerializedMap<number, string>;
    autoRefresh?: boolean;
    reopenTabInventory?: boolean;
}