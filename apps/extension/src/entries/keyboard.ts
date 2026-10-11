/** Keep page shortcuts from consuming keys intended for the companion UI. */
export function isolateCompanionKeyboard(shadow: ShadowRoot) {
  const contain = (event: Event) => {
    // Escape also drives the companion's document/window cancel handlers.
    if ((event as KeyboardEvent).key !== "Escape") event.stopPropagation();
  };
  const types = ["keydown", "keypress", "keyup"] as const;
  // Bubble after the controls and React have handled the key. Do not prevent
  // defaults: text entry, IME composition and native focus navigation still work.
  for (const type of types) shadow.addEventListener(type, contain);
  return () => { for (const type of types) shadow.removeEventListener(type, contain); };
}
