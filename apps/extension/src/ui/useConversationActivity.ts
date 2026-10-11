import { useEffect, useRef, useState } from "react";
import { isRecord, type ConversationActivity } from "@core";
import { request, subscribe } from "../bridge";

interface SharedMessage { id: string; role: "user" | "assistant" | "status"; text: string; at: number }
function activityValue(value: unknown): ConversationActivity | null {
  if (!isRecord(value) || typeof value.runId !== "string" || !/^[\w.-]{1,160}$/.test(value.runId) ||
    !Number.isInteger(value.tabId) || !["thinking", "acting", "confirming"].includes(String(value.phase)) ||
    typeof value.status !== "string" || value.status.length > 500 || typeof value.site !== "string" ||
    value.site.length > 253 || typeof value.title !== "string" || value.title.length > 300) return null;
  return value as unknown as ConversationActivity;
}

/** Follow work and saved replies belonging to this chat across browser tabs. */
export function useConversationActivity(conversationId: string, onMessages: (messages: SharedMessage[]) => void) {
  const [current, setCurrent] = useState<{ id: string; activity: ConversationActivity | null }>({ id: "", activity: null });
  const receive = useRef(onMessages); receive.current = onMessages;
  useEffect(() => {
    if (!conversationId) return;
    let live = true, activityVersion = 0, messagesVersion = 0;
    const loadMessages = async () => {
      const version = ++messagesVersion;
      const saved = await request<{ messages: SharedMessage[] }>({ type: "conversation.open", conversationId });
      if (live && version === messagesVersion && Array.isArray(saved?.messages)) receive.current(saved.messages);
    };
    const unsubscribe = subscribe((event) => {
      if (!live || event.conversationId !== conversationId) return;
      if (event.type === "conversation.activity") {
        activityVersion++;
        setCurrent({ id: conversationId, activity: activityValue(event.activity) });
      }
      if (event.type === "conversation.changed") void loadMessages().catch(() => {});
    });
    const version = activityVersion;
    void request({ type: "conversation.activity.get", conversationId }).then((value) => {
      if (live && version === activityVersion) setCurrent({ id: conversationId, activity: activityValue(value) });
    }).catch(() => {});
    return () => { live = false; unsubscribe(); };
  }, [conversationId]);
  return current.id === conversationId ? current.activity : null;
}
