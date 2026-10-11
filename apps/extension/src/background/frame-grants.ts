type Message = Record<string, unknown>;
export interface FrameGrant {
  token: string;
  tool: string;
  channel: string;
  conversationId: string;
  tabId: number;
  owner: string;
  expiresAt: number;
}
export interface FrameGrantStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}
const KEY = "hypeman.frameGrants";
const FRAME_PAGES: Record<string, string> = {
  documents: "documents.html", phone: "preferences.html", settings: "preferences.html", connection: "connection.html",
};
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const owner = (sender: chrome.runtime.MessageSender) => `${sender.tab?.id}:${sender.frameId ?? 0}:${sender.documentId ?? sender.url ?? ""}`;

/** The token is sent through postMessage directly to the extension frame, never through its URL. */
export function createFrameGrantHandler(storage: FrameGrantStorage, extensionOrigin: string, now = Date.now) {
  let pending: Promise<unknown> = Promise.resolve();
  return (message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> | undefined => {
    if (!["frame.grant", "frame.check", "frame.revoke"].includes(String(message.type))) return undefined;
    const work = pending.catch(() => undefined).then(async () => {
      if (sender.id !== extensionOrigin.slice("chrome-extension://".length) || !Number.isInteger(sender.tab?.id))
        throw new Error("Unknown tool screen.");
      const saved = (await storage.get(KEY))[KEY];
      const grants = Array.isArray(saved) ? saved.filter((value): value is FrameGrant =>
        !!value && typeof value === "object" && typeof value.token === "string" && typeof value.expiresAt === "number" && value.expiresAt > now()) : [];
      if (message.type === "frame.revoke") {
        const grant = grants.find((value) => value.token === message.token);
        if (grant && grant.owner !== owner(sender)) throw new Error("This tool screen belongs to another page.");
        await storage.set({ [KEY]: grants.filter((value) => value.token !== message.token) });
        return { ok: true };
      }
      if (!identifier(message.channel) || !identifier(message.conversationId) ||
        typeof message.tool !== "string" || !FRAME_PAGES[message.tool]) throw new Error("Unknown tool screen.");
      if (message.type === "frame.grant") {
        if (Object.values(FRAME_PAGES).some((page) => sender.url?.split(/[?#]/)[0] === `${extensionOrigin}/${page}`))
          throw new Error("A tool frame cannot authorize itself.");
        const grant: FrameGrant = { token: crypto.randomUUID(), tool: message.tool, channel: message.channel,
          conversationId: message.conversationId, tabId: sender.tab!.id!, owner: owner(sender), expiresAt: now() + 60 * 60_000 };
        // A long-lived conversation can replace its frame without growing session storage forever.
        const retained = grants.filter((value) => !(value.owner === grant.owner && value.tool === grant.tool && value.channel === grant.channel));
        await storage.set({ [KEY]: [...retained.slice(-255), grant] });
        return { token: grant.token };
      }
      const grant = grants.find((value) => value.token === message.token);
      if (!grant || grant.tabId !== sender.tab!.id || grant.tool !== message.tool || grant.channel !== message.channel ||
        grant.conversationId !== message.conversationId || sender.url?.split(/[?#]/)[0] !== `${extensionOrigin}/${FRAME_PAGES[grant.tool]}`)
        throw new Error("This tool screen is no longer authorized. Reopen it from your conversation.");
      return { ok: true };
    });
    pending = work; return work;
  };
}
let handler: ReturnType<typeof createFrameGrantHandler> | undefined;
export function handleFrameGrantMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> | undefined {
  if (!["frame.grant", "frame.check", "frame.revoke"].includes(String(message.type))) return undefined;
  handler ??= createFrameGrantHandler(chrome.storage.session, chrome.runtime.getURL("").replace(/\/$/, ""));
  if (!Number.isInteger(sender.tab?.id) && sender.documentId) {
    return chrome.runtime.getContexts({ documentIds: [sender.documentId] }).then((contexts) => {
      const context = contexts.find((value) => value.documentId === sender.documentId && value.tabId >= 0);
      return handler!(message, context ? { ...sender, tab: { ...sender.tab, id: context.tabId } as chrome.tabs.Tab } : sender);
    });
  }
  return handler(message, sender);
}
export async function checkDocumentFrame(message: Message, sender: chrome.runtime.MessageSender) {
  await handleFrameGrantMessage({ type: "frame.check", tool: "documents", channel: message.frameChannel,
    conversationId: message.conversationId, token: message.frameToken }, sender);
}
