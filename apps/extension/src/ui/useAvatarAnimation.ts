import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserTask } from "@core";
import atlas from "../../public/assets/y2k/hypeman-atlas.json";

export type AvatarAnimation = keyof typeof atlas.animations;
export interface AvatarActivity {
  phase: "idle" | "thinking" | "confused" | "point";
  conversationId?: string;
  task?: BrowserTask | null;
  hintId?: string;
  /** A fresh token only after a finish action succeeds. */
  celebration?: string;
}
type Reaction = { state: "greet" | "wave" | "point" | "hype" | "celebrate"; id: number };

/** One lifecycle for the webpage mascot and both new-tab avatars. */
export function useAvatarAnimation({ activity, open, dragging = false }: {
  activity: AvatarActivity; open: boolean; dragging?: boolean;
}) {
  const sequence = useRef(1);
  const [reaction, setReaction] = useState<Reaction | null>(() => open ? { state: "greet", id: 1 } : null);
  const [rest, setRest] = useState<"idle" | "sleepy" | "afk">("idle");
  const previous = useRef({ activity, open, dragging });
  useEffect(() => {
    const before = previous.current;
    previous.current = { activity, open, dragging };
    const react = (state: Reaction["state"]) => setReaction(activity.phase !== "idle" && state !== "celebrate" && state !== "hype" ? null : { state, id: ++sequence.current });
    const switched = before.activity.conversationId && before.activity.conversationId !== activity.conversationId;
    if (switched) { if (open) react("greet"); else setReaction(null); return; }
    const task = activity.task, oldTask = before.activity.task;
    if (activity.celebration && activity.celebration !== before.activity.celebration && activity.conversationId === before.activity.conversationId) react("celebrate");
    else if (task && oldTask?.id === task.id && task.status === "completed" && oldTask.status !== "completed") react("celebrate");
    else if (task?.status === "running" && oldTask?.id === task.id && task.steps.some((step) => step.status === "done" && oldTask.steps.find((old) => old.id === step.id)?.status !== "done")) react("hype");
    else if (activity.hintId && activity.hintId !== before.activity.hintId) react("point");
    else if (open !== before.open) react(open ? "greet" : "wave");
    else if (dragging || activity.phase === "confused" || (task?.status === "cancelled" && oldTask?.status !== "cancelled")) setReaction(null);
    else if (activity.phase !== "idle") {
      // Work interrupts greetings; earned celebrations wait until the work settles.
      setReaction((current) => current?.state === "celebrate" || current?.state === "hype" ? current : null);
    }
  }, [activity, open, dragging]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastInput = Date.now();
    const check = () => {
      const elapsed = Date.now() - lastInput;
      setRest(elapsed >= 120_000 ? "afk" : elapsed >= 60_000 ? "sleepy" : "idle");
      if (elapsed < 120_000) timer = setTimeout(check, (elapsed < 60_000 ? 60_000 : 120_000) - elapsed);
    };
    const wake = () => {
      clearTimeout(timer); lastInput = Date.now(); setRest("idle");
      if (activity.phase === "idle" && !dragging) timer = setTimeout(check, 60_000);
    };
    const visible = () => { if (!document.hidden) wake(); };
    wake();
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake); window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake); window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [activity.phase, activity.hintId, open, dragging]);

  const state: AvatarAnimation = dragging ? "walk" : activity.phase !== "idle" ? activity.phase : reaction?.state ?? rest;
  const reactionId = reaction?.id;
  const onComplete = useCallback(() => {
    setReaction((current) => current?.id === reactionId ? null : current);
  }, [reactionId]);
  return { state, animationKey: reactionId ?? 0, once: state === reaction?.state, onComplete };
}
