import { conversationTurns, focusAgentContext, reminderConversation, validMessagingTimezone,
  parseReminderRecurrence, type ReminderRecurrence, type AgentRequest, type AgentReply, type MessagingStatus, type ReminderDraft } from "@core";

interface Dependencies {
  conversation(id: string): Promise<{ messages: Array<{ role: string; text: string; at: number }> }>;
  draft(id: string): Promise<unknown>;
  saveDraft(id: string, draft: ReminderDraft | null): Promise<void>;
  phoneStatus(): Promise<MessagingStatus>;
  schedule(text: string, dueAt: number, idempotencyKey: string, recurrence?: ReminderRecurrence): Promise<unknown>;
  now?: () => number;
  timezone?: () => string;
}
const parseDraft = (value: unknown): ReminderDraft | null => {
  if (!value || typeof value !== "object") return null;
  const draft = value as ReminderDraft;
  if (!validMessagingTimezone(draft.timezone) || !Number.isFinite(draft.updatedAt) || typeof draft.requestId !== "string" || !/^[\w.-]{1,160}$/.test(draft.requestId) ||
      (draft.text !== undefined && (typeof draft.text !== "string" || draft.text.length > 2000)) ||
      (draft.sourceMessage !== undefined && (typeof draft.sourceMessage !== "string" || draft.sourceMessage.length > 4000)) ||
      (draft.recurrence !== undefined && !parseReminderRecurrence(draft.recurrence)) ||
      (draft.repeat !== undefined && (!draft.repeat || !["daily", "weekly"].includes(draft.repeat.frequency) || !Number.isInteger(draft.repeat.interval) || draft.repeat.interval < 1 || draft.repeat.interval > 52 || (draft.repeat.weekdays !== undefined && (!Array.isArray(draft.repeat.weekdays) || !draft.repeat.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6))))) ||
      [draft.hour, draft.minute, draft.dueAt, draft.weekday].some((number) => number !== undefined && !Number.isFinite(number)) ||
      (draft.timezoneUnresolved !== undefined && typeof draft.timezoneUnresolved !== "boolean") || (draft.needsDate !== undefined && typeof draft.needsDate !== "boolean") || (draft.nextWeek !== undefined && typeof draft.nextWeek !== "boolean") ||
      (draft.date !== undefined && (typeof draft.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date))) ||
      (draft.day !== undefined && !["today", "tomorrow"].includes(draft.day)) || (draft.meridiem !== undefined && !["AM", "PM"].includes(draft.meridiem))) return null;
  return draft;
};

/** One owner for chat memory and reminder slots across pages, iframe tools, and worker restarts. */
export class ConversationAssistance {
  private queues = new Map<string, Promise<unknown>>();
  private generations = new Map<string, number>();
  constructor(private dependencies: Dependencies) {}
  private track<T>(id: string, next: Promise<T>): Promise<T> {
    this.queues.set(id, next);
    void next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => {});
    return next;
  }
  checkpoint(id?: string): () => void {
    const generation = id ? this.generations.get(id) || 0 : 0;
    return () => { if (id && (this.generations.get(id) || 0) !== generation) throw new DOMException("Cancelled", "AbortError"); };
  }
  cancel(id: unknown): Promise<void> {
    if (typeof id !== "string" || !/^[\w.-]{1,160}$/.test(id)) return Promise.reject(new Error("Choose a saved conversation."));
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    // Stop immediately, even while a previous turn is waiting on the phone service.
    return this.track(id, Promise.resolve().then(() => this.dependencies.saveDraft(id, null)));
  }
  prepare(input: AgentRequest, check = this.checkpoint(input.conversationId)): Promise<{ input: AgentRequest; reply?: AgentReply }> {
    if (!input.conversationId) return Promise.resolve({ input });
    const id = input.conversationId;
    return this.track(id, (this.queues.get(id) || Promise.resolve()).catch(() => {}).then(() => this.turn(input, check)));
  }
  private async turn(input: AgentRequest, check: () => void): Promise<{ input: AgentRequest; reply?: AgentReply }> {
    const id = input.conversationId!, api = this.dependencies;
    check();
    const conversation = await api.conversation(id);
    check();
    const clock = { now: (api.now || Date.now)(), timezone: api.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York" };
    input = { ...input, conversation: conversationTurns(conversation.messages, input.message), clock };
    let draft = parseDraft(await api.draft(id));
    check();
    // Cancellation is also represented in chat history when the runtime handles Stop locally.
    if (draft && input.conversation?.some((turn) => turn.role === "user" && turn.at > draft!.updatedAt && /^(?:cancel|never ?mind|stop)[.!]?$/i.test(turn.text.trim()))) draft = null;
    let turn = reminderConversation(input.message, draft, clock, input.requestId);
    const reply = (text: string): { input: AgentRequest; reply: AgentReply } => ({ input: focusAgentContext(input), reply: { action: { type: "say", text }, done: true, provider: "local", contextScope: "conversation" } });
    if (turn.kind === "cancel") { await this.cancel(id); return reply("Reminder draft cancelled."); }
    if (turn.kind === "unrelated") {
      if (draft) await api.saveDraft(id, null);
      check();
      return { input: focusAgentContext(input) };
    }
    // A paired phone's saved timezone is the default. Explicit timezones always override it.
    let phone: MessagingStatus | undefined;
    if (!draft) {
      try { phone = await api.phoneStatus(); } catch { /* Still retain the request and clarify its time. */ }
      check();
      if (phone?.paired) turn = reminderConversation(input.message, null, { ...clock, timezone: phone.settings.timezone }, input.requestId);
    }
    if (turn.kind !== "reminder") return { input: focusAgentContext(input) };
    await api.saveDraft(id, turn.draft);
    check();
    if (turn.question) return reply(turn.question);
    try {
      phone ??= await api.phoneStatus();
      check();
      if (!phone.paired) return reply("Pair your phone first, then say ‘try again’. I’ve kept your reminder details.");
      if (turn.draft.recurrence) await api.schedule(turn.draft.text!, turn.dueAt!, turn.draft.requestId, turn.draft.recurrence);
      else await api.schedule(turn.draft.text!, turn.dueAt!, turn.draft.requestId);
      check();
      await api.saveDraft(id, null);
      check();
      return reply(`Reminder saved: ${turn.draft.text} · ${turn.label}${turn.draft.recurrence ? ` · repeats ${turn.draft.recurrence.frequency}` : ""}.`);
    } catch (cause) {
      check();
      const reason = cause instanceof Error ? cause.message : "The phone service is unavailable.";
      return reply(`I couldn’t confirm the reminder: ${reason.slice(0, 220)} Your details are saved; say ‘try again’.`);
    }
  }
}
