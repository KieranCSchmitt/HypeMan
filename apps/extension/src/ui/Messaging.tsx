import { useCallback, useEffect, useRef, useState } from "react";
import { validMessagingTimezone, type MessagingCapture, type MessagingPairingResult, type MessagingSettings, type MessagingStatus } from "@core";
import { request, subscribe } from "../bridge";
import { Notice, ToolButton } from "./common";
import { message, relativeTime } from "./hooks";
import { useToolHandler, useWorkbench } from "./WorkbenchContext";
interface PhoneInboxResult { captures: MessagingCapture[]; status: MessagingStatus | null; error?: string }
function useMessaging(connectionKey = "") {
  const [status, setStatus] = useState<MessagingStatus | null>(null);
  const [captures, setCaptures] = useState<MessagingCapture[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async (signal?: AbortSignal, sync = true) => {
    const result = await request<PhoneInboxResult>({ type: "messaging.inbox", ...(sync ? {} : { refresh: false }) }, signal);
    if (signal?.aborted) return;
    if (!result || !Array.isArray(result.captures)) throw new Error("Phone messaging is unavailable. Restart the local gateway and reload HypeMan.");
    setCaptures(result.captures); setStatus(result.status?.settings ? result.status : null); setError(result.error || ""); setLoading(false); return result;
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    const update = (sync: boolean) => void refresh(controller.signal, sync).catch((cause) => { if (!controller.signal.aborted) { setError(message(cause)); setLoading(false); } });
    update(true);
    const remove = subscribe((event) => { if (event.type === "messaging.changed") update(false); });
    const poll = () => { if (document.visibilityState === "visible") update(false); };
    const timer = setInterval(poll, 15000); document.addEventListener("visibilitychange", poll);
    return () => { controller.abort(); remove(); clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [connectionKey, refresh]);
  return { status, captures, error, loading, refresh };
}
function Captures({ captures, onAction }: { captures: MessagingCapture[]; onAction?: (operation: string, args: Record<string, unknown>) => void }) {
  const workbench = useWorkbench();
  return <section className="phone-inbox" aria-label="Phone inbox">{captures.length ? captures.map((capture) => {
    const select = () => workbench.selectContent({ kind: "phone-capture", id: capture.id, text: capture.text, url: capture.url, title: capture.kind });
    return <article key={capture.id} className="phone-item" tabIndex={0} onClick={select} onFocus={select} data-selected={workbench.selected?.id === capture.id}><small>{capture.kind} · {relativeTime(capture.createdAt)}</small><p>{capture.text}</p>{capture.url && <a className="source-link" href={capture.url} target="_blank" rel="noreferrer">{capture.url} ↗</a>}{onAction && <div className="tool-actions" onClick={(event) => event.stopPropagation()}><ToolButton icon="play" label="Continue idea" onClick={() => onAction("continue", { id: capture.id })} /><ToolButton icon="close" label="Dismiss idea" onClick={() => onAction("dismiss", { id: capture.id })} /></div>}</article>;
  }) : <p>Inbox empty</p>}</section>;
}
export function PhoneInbox() { const phone = useMessaging(); return <><Notice tone="error">{phone.error}</Notice><Captures captures={phone.captures} /></>; }
export function Messaging({ connectionKey }: { connectionKey: string }) {
  const phone = useMessaging(connectionKey);
  const workbench = useWorkbench();
  const [pairing, setPairing] = useState<MessagingPairingResult | null>(null);
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState<MessagingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("Inbox"), [number, setNumber] = useState("");
  const [sending, setSending] = useState(false), [text, setText] = useState("");
  const [addingReminder, setAddingReminder] = useState(false), [reminderText, setReminderText] = useState(""), [reminderTime, setReminderTime] = useState("");
  const abort = useRef<AbortController | null>(null);
  const status = phone.status;
  useEffect(() => { if (status?.settings) setDraft({ ...status.settings }); }, [status?.settings.coachingEnabled, status?.settings.morningTime, status?.settings.eveningTime, status?.settings.timezone, status?.settings.projectUpdates, status?.settings.proactiveEnabled]);
  useEffect(() => { if (status?.paired) setPairing(null); }, [status?.paired]);
  useEffect(() => {
    const cancel = () => abort.current?.abort(); window.addEventListener("hypeman.cancel-tools", cancel);
    return () => { cancel(); window.removeEventListener("hypeman.cancel-tools", cancel); };
  }, []);
  useEffect(() => {
    if (!pairing || pairing.expiresAt <= now) return;
    const timer = setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void phone.refresh().catch((cause) => setError(message(cause))); }, 1500);
    return () => clearInterval(timer);
  }, [pairing, pairing ? pairing.expiresAt <= now : true, phone.refresh]);
  const act = async (type: string, values: Record<string, unknown> = {}) => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const started = Date.now();
    setBusy(true); setError(""); setNotice("");
    try { const result = await request<{ status?: string }>({ type, ...values }, controller.signal); if (type === "messaging.send" && ["unknown", "failed"].includes(String(result?.status))) throw new Error(result.status === "unknown" ? "Delivery is uncertain. Check your phone before sending again." : "Text delivery failed."); await phone.refresh(undefined, false); return result; }
    catch (cause) {
      let reported = cause;
      if (type === "messaging.send" && !controller.signal.aborted) {
        const latest = await phone.refresh(controller.signal).catch(() => undefined);
        if (latest?.status?.deliveries.some((delivery) => delivery.status === "unknown" && delivery.at >= started && delivery.text === values.text)) reported = new Error("Delivery is uncertain. Check your phone before sending again.");
      }
      if (!controller.signal.aborted) setError(message(reported)); throw reported;
    }
    finally { if (abort.current === controller) setBusy(false); }
  };
  const save = async (changes: Partial<MessagingSettings>) => {
    if (!draft) throw new Error("Phone preferences are unavailable.");
    const next = { ...draft, ...changes };
    if (!validMessagingTimezone(next.timezone)) throw new Error("Enter a valid timezone, such as America/New_York.");
    if ([next.morningTime, next.eveningTime].some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || time < "09:00" || time >= "21:00")) throw new Error("Choose check-in times between 9 AM and 9 PM.");
    await act("messaging.settings", { patch: changes }); setDraft(next); setNotice("");
  };
  const handlePhone = async (operation: string, args: Record<string, unknown>) => {
    const selected = args.selected && typeof args.selected === "object" ? args.selected as typeof workbench.selected : workbench.selected;
    if (["open", "status", "inbox", "reminders"].includes(operation)) { const current = await phone.refresh(); return current?.status?.paired ? `Phone companion connected to ${current.status.ownerPhone || "your phone"}. ${current.captures.length} saved ideas.` : "Ask to pair your phone, including its country code."; }
    if (operation === "pair") {
      const number = String(args.phone || "").trim(); if (!number) throw new Error("Tell me your phone number, including its country code.");
      const result = await act("messaging.pair", { phone: number }) as MessagingPairingResult; setPairing(result); setNow(Date.now());
      return `Pairing code: PAIR ${result.code}. Reply with this from your phone. ${result.deliveryStatus === "unknown" ? "Invitation delivery is uncertain; it will not be resent automatically." : "Invitation text requested."}`;
    }
    if (operation === "unpair") { await act("messaging.unpair"); setPairing(null); return "Phone unpaired."; }
    if (operation === "test" || operation === "send") {
      let raw = operation === "test" ? "HypeMan is connected. Text me an idea, goal, or reminder." : String(args.text || selected?.text || "");
      if (operation === "send" && selected?.url && ["note", "project", "video"].includes(selected.kind) && !raw.includes(selected.url)) raw += `\n\nSource: ${selected.url}`;
      const text = raw.length > 6000 ? `${raw.slice(0, 5980)}\n[Text shortened]` : raw;
      if (!text.trim()) throw new Error("Select the content to text, or say what to send.");
      await act("messaging.send", { text }); return "Text requested for your paired phone.";
    }
    if (operation === "settings") { const changes = args.patch && typeof args.patch === "object" ? args.patch as Partial<MessagingSettings> : Object.fromEntries(Object.entries(args).filter(([key]) => !["conversationId", "selected"].includes(key))) as Partial<MessagingSettings>; await save(changes); return "Phone preferences saved."; }
    if (operation === "continue" || operation === "dismiss") {
      const id = String(args.id || (selected?.kind === "phone-capture" ? selected.id : "")); if (!id) throw new Error("Select a phone idea first.");
      await act(`messaging.${operation}`, { id }); return operation === "continue" ? "Continuing that idea in Chrome." : "Phone idea dismissed.";
    }
    if (operation === "snooze" || operation === "cancel") {
      const id = String(args.id || (selected?.kind === "reminder" ? selected.id : "")); if (!id) throw new Error("Select a reminder first.");
      await act("messaging.reminders", { operation, id, ...(operation === "snooze" ? { minutes: Number(args.minutes || 60) } : {}) }); return operation === "snooze" ? "Reminder snoozed." : "Reminder cancelled.";
    }
    if (operation === "remind") { await act("messaging.remind", args); return "Reminder scheduled."; }
    throw new Error("That phone action is unavailable.");
  };
  useToolHandler("phone", handlePhone);
  const stateLabel = !status ? "Unavailable" : !status.configured ? "Setup needed" : !status.connected ? "Disconnected" : status.paired ? "Connected" : "Ready to pair";
  const formatTime = (at: number) => new Date(at).toLocaleString(undefined, { timeZone: validMessagingTimezone(status?.settings.timezone) ? status!.settings.timezone : "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const update = (changes: Partial<MessagingSettings>) => void save(changes).catch((cause) => setError(message(cause)));
  const run = async (operation: string, args: Record<string, unknown> = {}) => {
    try { await handlePhone(operation, args); if (["send", "remind"].includes(operation)) setNotice(operation === "send" ? "Text requested" : "Reminder saved"); return true; }
    catch (cause) { setError(message(cause)); return false; }
  };
  return <section className="phone-messaging" aria-label="Phone companion" aria-busy={busy || phone.loading}>
    <div className="tool-toolbar"><span className={`connection-dot ${status?.paired ? "connected" : ""}`} aria-hidden="true" /><span title={status?.ownerPhone || ""}>{phone.loading ? "Connecting…" : status?.paired ? `Paired · •••• ${status.ownerPhone?.slice(-4) || ""}` : stateLabel}</span><ToolButton icon="rewind" label="Sync phone" disabled={busy} onClick={() => void phone.refresh().catch((cause) => setError(message(cause)))} />{status?.paired && <ToolButton icon="close" label="Unpair phone" disabled={busy} onClick={() => void run("unpair")} />}</div>
    <Notice tone="error">{error || phone.error || status?.error}</Notice><Notice>{notice}</Notice>
    {!phone.loading && !status?.configured && <details><summary>Setup needed</summary><p>Configure Photon in the local server, then reconnect.</p></details>}
    {status?.lastSyncedAt && Date.now() - status.lastSyncedAt > 120000 ? <small className="tool-status" title={`Last synced ${formatTime(status.lastSyncedAt)}`}>Sync needed</small> : null}
    {!status?.paired && <form className="tool-form tool-toolbar" onSubmit={(event) => { event.preventDefault(); void run("pair", { phone: number }); }}><input type="tel" aria-label="Phone number" placeholder="+1 555 000 0142" value={number} onChange={(event) => setNumber(event.target.value)} required /><button type="submit" className="button primary" disabled={busy || !number.trim() || !status?.configured}>Pair</button></form>}
    {pairing && !status?.paired && <div className="phone-pair-code" role="status">{pairing.expiresAt > now ? <><strong>PAIR {pairing.code}</strong><small>Reply from your phone · {formatTime(pairing.expiresAt)}</small>{pairing.deliveryStatus === "unknown" && <small>Invitation delivery is uncertain</small>}</> : <span>Pairing code expired</span>}</div>}
    <div className="tool-tabs" role="tablist" aria-label="Phone views">{["Inbox", "Reminders", "Check-ins"].map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    <div className="tool-content">
      <div hidden={tab !== "Inbox"}><Captures captures={phone.captures} onAction={(operation, args) => void run(operation, args)} /></div>
      <section hidden={tab !== "Reminders"} aria-label="Phone reminders"><div className="tool-toolbar"><ToolButton icon="plus" label="New reminder" disabled={!status?.paired} onClick={() => setAddingReminder(!addingReminder)} /></div>{addingReminder && <form className="tool-form" onSubmit={(event) => { event.preventDefault(); void run("remind", { text: reminderText, dueAt: new Date(reminderTime).getTime() }).then((saved) => { if (saved) setAddingReminder(false); }); }}><input aria-label="Reminder" placeholder="Remind me…" value={reminderText} onChange={(event) => setReminderText(event.target.value)} required /><input aria-label="Reminder time" type="datetime-local" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} required /><button type="submit" className="button primary" disabled={busy}>Save</button></form>}{status?.reminders.filter((reminder) => reminder.status !== "cancelled").slice(-20).reverse().map((reminder) => { const select = () => workbench.selectContent({ kind: "reminder", id: reminder.id, text: reminder.text, title: "Reminder" }); return <article key={reminder.id} className="phone-item" tabIndex={0} onFocus={select} onClick={select}><p>{reminder.text}</p><time>{formatTime(reminder.dueAt)} · {reminder.status === "pending" && reminder.dueAt < Date.now() ? "overdue" : reminder.status === "unknown" ? "delivery uncertain" : reminder.status}</time>{reminder.status === "pending" && <div className="tool-actions"><button className="button" disabled={busy} onClick={() => void run("snooze", { id: reminder.id, minutes: 60 })}>+1h</button><ToolButton icon="close" label="Cancel reminder" disabled={busy} onClick={() => void run("cancel", { id: reminder.id })} /></div>}</article>; })}{!status?.reminders.some((reminder) => reminder.status !== "cancelled") && <div className="tool-empty">No reminders</div>}</section>
      <div hidden={tab !== "Check-ins"}>{draft && <fieldset disabled={busy || !status?.paired}><legend>Check-ins</legend>
        <label><input type="checkbox" checked={draft.proactiveEnabled} onChange={(event) => update({ proactiveEnabled: event.target.checked })} /> Proactive texts</label>
        <label><input type="checkbox" checked={draft.coachingEnabled} onChange={(event) => update({ coachingEnabled: event.target.checked })} /> Daily planning</label>
        <label className="field">Morning<input type="time" aria-label="Morning planning time" value={draft.morningTime} min="09:00" max="20:59" onChange={(event) => update({ morningTime: event.target.value })} /></label>
        <label className="field">Evening<input type="time" aria-label="Evening reflection time" value={draft.eveningTime} min="09:00" max="20:59" onChange={(event) => update({ eveningTime: event.target.value })} /></label>
        <label className="field">Timezone<input aria-label="Phone timezone" value={draft.timezone} maxLength={100} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} onBlur={(event) => update({ timezone: event.target.value })} /></label>
        <label><input type="checkbox" checked={draft.projectUpdates} onChange={(event) => update({ projectUpdates: event.target.checked })} /> Project updates</label><small title="Requested reminders can arrive at any time. STOP mutes proactive texts; START restores them.">Quiet hours · 9 PM–9 AM</small>
      </fieldset>}{!!status?.commitments.length && <details><summary>Daily commitments · self-reported</summary>{status.commitments.slice(-10).reverse().map((commitment) => <article key={commitment.id}><p>{commitment.text}</p><small>{commitment.date} · {commitment.done ? "Reported done" : "Planned"}</small></article>)}</details>}</div>
      {!!status?.deliveries.some((delivery) => ["failed", "unknown"].includes(delivery.status)) && <details><summary>Delivery issues</summary><small>Uncertain deliveries are not automatically resent.</small>{status.deliveries.filter((delivery) => ["failed", "unknown"].includes(delivery.status)).slice(-10).map((delivery) => <article key={delivery.id}><p>{delivery.text}</p><small>{delivery.status} · {formatTime(delivery.at)}</small><p>{delivery.error}</p></article>)}</details>}
    </div>
    {status?.paired && <div className="tool-toolbar"><button type="button" className="button primary" onClick={() => { setSending(!sending); setText(workbench.selected?.text || ""); }}>Text me</button></div>}
    {sending && <form className="tool-form" onSubmit={(event) => { event.preventDefault(); void run("send", { text }).then((sent) => { if (sent) setSending(false); }); }}><textarea aria-label="Text to phone" placeholder="Message…" value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={6000} /><button type="submit" className="button primary" disabled={busy || !text.trim()}>Send</button></form>}
  </section>;
}
