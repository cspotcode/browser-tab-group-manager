// Offscreen document — has DOM/window context, can use File System Access API

let counter = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let activeHandle: FileSystemFileHandle | null = null;

async function startCounter(handle: FileSystemFileHandle) {
  activeHandle = handle;
  counter = 0;

  if (intervalId !== null) {
    clearInterval(intervalId);
  }

  intervalId = setInterval(async () => {
    counter++;
    try {
      const writable = await activeHandle!.createWritable();
      await writable.write(`Hello world! ${counter}`);
      await writable.close();
    } catch (e) {
      console.error('[offscreen] Failed to write to file:', e);
    }
  }, 1000);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_COUNTER') {
    startCounter(message.fileHandle as FileSystemFileHandle);
  }
});
