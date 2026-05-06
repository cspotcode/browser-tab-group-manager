// Generic extension messaging utilities.

// ── Types ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandlers = Record<string, (...args: any[]) => Promise<any>>;

type NotificationMessage = { type: string };

// ── send a request and await the response ─────────

// TODO is annoying to bind both generic params explicitly, should be able to pre-bind one and infer the other
export function send<
  Handlers extends AnyHandlers,
  K extends keyof Handlers & string,
>(
  type: K,
  ...args: Parameters<Handlers[K]>
): ReturnType<Handlers[K]> {
  return chrome.runtime.sendMessage({ type, args }) as unknown as ReturnType<Handlers[K]>;
}

// ── bind async handler functions to the message listener ──────────

export function bindListeners<Handlers extends AnyHandlers>(
  handlers: Partial<{ [K in keyof Handlers]: Handlers[K] }>,
): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = handlers[message.type as keyof Handlers];
    if (!handler) return false;
    (handler as (...a: unknown[]) => Promise<unknown>)(...(message.args ?? [])).then(sendResponse);
    return true;
  });
}

// ── Notifications: fire-and-forget broadcasts which do not expect a return value ─────

export function sendNotification<N extends NotificationMessage>(type: N['type']): void {
  chrome.runtime.sendMessage({ type }).catch(() => {
    // No listeners open — ignore
  });
}

export function onNotification<N extends NotificationMessage>(
  type: N['type'],
  handler: () => void,
): () => void {
  const listener = (message: N) => {
    if (message.type === type) handler();
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

// --- (De)Serializers ---

// Chrome / Edge extension messaging does not (yet) support structured clone, so
// we are limited to JSON structs.
// See also: https://developer.chrome.com/blog/structured-clone-messaging

export type SerializedMap<K, V> = [K, V][];

export function serializeMap<K, V>(map: Map<K, V>) {
  return [...map.entries()];
}
export function deserializeMap<K, V>(entries: [K, V][]) {
  return new Map(entries);
}

export type SerializedSet<V> = V[];

export function serializeSet<V>(set: Set<V>) {
  return [...set];
}
export function deserializeSet<V>(values: V[]) {
  return new Set(values);
}
