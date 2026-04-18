// Popup entry point

const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement;
const openInventoryBtn = document.getElementById('open-inventory-btn') as HTMLButtonElement;

reloadBtn.addEventListener('click', async () => {
  if (window.location.href.startsWith(chrome.runtime.getURL(''))) {
    await chrome.runtime.sendMessage({ type: 'REOPEN_AFTER_RELOAD', url: window.location.href });
  }
  chrome.runtime.reload();
});

openInventoryBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('tab-inventory.html') });
});
