// Popup entry point

const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const openInventoryBtn = document.getElementById('open-inventory-btn') as HTMLButtonElement;

reloadBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' });
});

openInventoryBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tab-inventory.html') });
});
