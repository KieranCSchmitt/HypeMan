import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationUIPatch, ConversationUIState } from "@core";
import { request } from "../bridge";

const merge = (state: ConversationUIState, patch: ConversationUIPatch): ConversationUIState => {
  const geometry = { ...state.geometry };
  for (const [id, snapshot] of Object.entries(patch.geometry || {})) {
    if (snapshot) geometry[id as keyof typeof geometry] = snapshot;
    else delete geometry[id as keyof typeof geometry];
  }
  const tools = patch.tools ?? state.tools;
  const active = patch.active === undefined ? state.active : patch.active;
  return { open: patch.open ?? state.open, tools, active: active && tools.includes(active) ? active : null, geometry };
};
const combine = (first: ConversationUIPatch, next: ConversationUIPatch): ConversationUIPatch => ({
  ...first, ...next, ...(first.geometry || next.geometry ? { geometry: { ...first.geometry, ...next.geometry } } : {}),
});

/** Conversation UI belongs to the task, so document and tab changes can restore it. */
export function useConversationUI(conversationId: string, initial: ConversationUIState, onRestore: (state: ConversationUIState) => ConversationUIState) {
  const [, render] = useState(0);
  const restore = useRef(onRestore); restore.current = onRestore;
  const current = useRef({ id: "", ready: false, state: initial, pending: {} as ConversationUIPatch, writes: Promise.resolve(), loaded: Promise.resolve() });
  if (current.current.id !== conversationId) {
    const pending = current.current.id ? {} : current.current.pending;
    current.current = { id: conversationId, ready: false, state: merge(initial, pending), pending, writes: Promise.resolve(), loaded: Promise.resolve() };
  }
  const write = useCallback((owner: typeof current.current, patch: ConversationUIPatch) => {
    // Dispatch while this document exists; the background serializes patches per conversation.
    const saving = request({ type: "workbench.ui.patch", conversationId: owner.id, patch }).catch(() => { /* A disconnected document must not interrupt the running task. */ });
    owner.writes = Promise.all([owner.writes, saving]).then(() => {});
  }, []);
  useEffect(() => {
    const owner = current.current;
    if (!conversationId) return;
    let live = true;
    owner.loaded = (async () => {
      let saved: ConversationUIState | null = null;
      try { saved = await request<ConversationUIState | null>({ type: "workbench.ui.get", conversationId }); } catch { /* Restore local defaults if storage is unavailable. */ }
      if (!live || current.current !== owner) return;
      const restored = merge(saved || owner.state, owner.pending);
      const next = restore.current(restored);
      owner.state = next; owner.ready = true;
      // Only explicit pending edits and visibility overrides replace existing saved fields.
      if (!saved) write(owner, next);
      else if (Object.keys(owner.pending).length || next.open !== restored.open) write(owner, { ...owner.pending, ...(next.open !== restored.open ? { open: next.open } : {}) });
      owner.pending = {};
      render((version) => version + 1);
    })();
    return () => { live = false; };
  }, [conversationId, write]);
  const owner = current.current;
  const patch = useCallback((patch: ConversationUIPatch) => {
    owner.state = merge(owner.state, patch);
    if (owner.ready) write(owner, patch);
    else owner.pending = combine(owner.pending, patch);
    if (current.current === owner) render((version) => version + 1);
  }, [owner, write]);
  const flush = useCallback(async () => {
    await owner.loaded;
    await owner.writes;
  }, [owner]);
  return { ready: current.current.ready, geometry: current.current.state.geometry, patch, flush };
}
