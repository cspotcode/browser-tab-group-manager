// Popup entry point
import { BackgroundService } from './background-service-client';

const background = new BackgroundService();

const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const openInventoryBtn = document.getElementById('open-inventory-btn') as HTMLButtonElement;

reloadBtn.addEventListener('click', () => {
  background.reloadExtension();
});

openInventoryBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tab-inventory.html') });
});
