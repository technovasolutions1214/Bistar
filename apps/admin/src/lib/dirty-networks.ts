// Which network cards have unsaved edits, shared between the Networks page and
// the tab bar in AdNetworksShell.
//
// It exists for one specific loss: the postback URL is a long string the panel
// insists you COPY from a network's dashboard rather than retype, and every tab
// in this panel is a plain route change that unmounts the card holding it. A
// module-scoped set is enough — the two components are always on the same page
// — and deliberately NOT localStorage: a draft postback URL can carry an
// account credential, and persisting it would outlive the session.

const dirty = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function markDirty(slug: string, isDirty: boolean) {
  const had = dirty.has(slug);
  if (isDirty) dirty.add(slug);
  else dirty.delete(slug);
  if (had !== dirty.has(slug)) notify();
}

export function dirtySlugs(): string[] {
  return [...dirty];
}

export function subscribeDirty(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Returns true when it is safe to leave — i.e. nothing unsaved, or the user
 *  chose to discard. Clears the set on discard so the prompt does not repeat. */
export function confirmLeave(): boolean {
  const slugs = dirtySlugs();
  if (slugs.length === 0) return true;
  const ok = window.confirm(
    `You have unsaved changes to ${slugs.length} network${slugs.length > 1 ? "s" : ""}. Leave and discard them?`,
  );
  if (ok) {
    dirty.clear();
    notify();
  }
  return ok;
}
