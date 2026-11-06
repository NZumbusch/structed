// Configurable keyboard shortcuts. Combos are strings like "Mod+Shift+K" where
// Mod = Ctrl (Windows/Linux) or ⌘ (macOS). User overrides live in settings.shortcuts.
import { settings } from './settings.svelte';

export type ShortcutGroup = 'General' | 'Stages' | 'Create' | 'Outline editing' | 'Writing';

export interface ShortcutDef {
  id: string;
  label: string;
  group: ShortcutGroup;
  default: string | null; // null = available but unassigned by default
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'search', label: 'Search & commands', group: 'General', default: 'Mod+K' },
  { id: 'togglePanel', label: 'Show / hide library panel (quotes)', group: 'General', default: 'Mod+\\' },
  { id: 'undo', label: 'Undo', group: 'General', default: 'Mod+Z' },
  { id: 'redo', label: 'Redo', group: 'General', default: 'Mod+Shift+Z' },
  { id: 'settings', label: 'Open settings', group: 'General', default: 'Mod+,' },
  { id: 'projects', label: 'All projects', group: 'General', default: null },
  { id: 'export', label: 'Export', group: 'General', default: null },
  { id: 'snapshot', label: 'Snapshots', group: 'General', default: null },
  { id: 'syncNow', label: 'Sync now', group: 'General', default: null },
  { id: 'toggleTheme', label: 'Toggle light / dark', group: 'General', default: null },
  { id: 'toggleContrast', label: 'Toggle high contrast', group: 'General', default: null },
  { id: 'focusLibrary', label: 'Search in library', group: 'General', default: null },
  { id: 'tour', label: 'Start guided tour', group: 'General', default: null },
  { id: 'stageOutline', label: 'Go to Outline', group: 'Stages', default: 'Alt+1' },
  { id: 'stageCollect', label: 'Go to Collect', group: 'Stages', default: 'Alt+2' },
  { id: 'stageSelect', label: 'Go to Select', group: 'Stages', default: 'Alt+3' },
  { id: 'stageArrange', label: 'Go to Arrange', group: 'Stages', default: 'Alt+4' },
  { id: 'stageDraft', label: 'Go to Draft', group: 'Stages', default: 'Alt+5' },
  { id: 'stageWrite', label: 'Go to Write', group: 'Stages', default: 'Alt+6' },
  { id: 'write.focus', label: 'Focus mode on / off', group: 'Writing', default: 'Mod+Shift+F' },
  { id: 'write.nextSection', label: 'Next section', group: 'Writing', default: 'Mod+Alt+ArrowDown' },
  { id: 'write.prevSection', label: 'Previous section', group: 'Writing', default: 'Mod+Alt+ArrowUp' },
  { id: 'write.notes', label: 'Show / hide notes', group: 'Writing', default: 'Mod+Alt+N' },
  { id: 'write.dim', label: 'Highlight current paragraph (focus mode)', group: 'Writing', default: null },
  { id: 'write.typewriter', label: 'Typewriter scrolling (focus mode)', group: 'Writing', default: null },
  { id: 'write.fullscreen', label: 'Full screen', group: 'Writing', default: null },
  { id: 'write.goal', label: 'Choose session goal', group: 'Writing', default: null },
  { id: 'write.sprint', label: 'Start / stop writing sprint', group: 'Writing', default: null },
  { id: 'write.footnote', label: 'Insert footnote', group: 'Writing', default: 'Mod+Alt+F' },
  { id: 'write.insertQuote', label: 'Insert a quote placed here', group: 'Writing', default: null },
  { id: 'write.insertMode', label: 'Switch how quotes are inserted', group: 'Writing', default: null },
  { id: 'write.editQuote', label: 'Edit quote text', group: 'Writing', default: null },
  { id: 'write.bulletList', label: 'Bullet list', group: 'Writing', default: null },
  { id: 'write.blockquote', label: 'Block quote (own text)', group: 'Writing', default: null },
  { id: 'write.export', label: 'Word export', group: 'Writing', default: null },
  { id: 'newQuote', label: 'New quote', group: 'Create', default: null },
  { id: 'newParaphrase', label: 'New paraphrase', group: 'Create', default: null },
  { id: 'newNote', label: 'New note', group: 'Create', default: null },
  { id: 'newSource', label: 'New source', group: 'Create', default: null },
  { id: 'importZotero', label: 'Import from Zotero', group: 'Create', default: null },
  { id: 'outline.newHeading', label: 'New heading (split at cursor)', group: 'Outline editing', default: 'Enter' },
  { id: 'outline.addChild', label: 'New subheading', group: 'Outline editing', default: null },
  { id: 'outline.indent', label: 'Indent', group: 'Outline editing', default: 'Tab' },
  { id: 'outline.outdent', label: 'Outdent', group: 'Outline editing', default: 'Shift+Tab' },
  { id: 'outline.moveUp', label: 'Move heading up', group: 'Outline editing', default: 'Alt+ArrowUp' },
  { id: 'outline.moveDown', label: 'Move heading down', group: 'Outline editing', default: 'Alt+ArrowDown' },
  { id: 'outline.prev', label: 'Previous heading', group: 'Outline editing', default: 'ArrowUp' },
  { id: 'outline.next', label: 'Next heading', group: 'Outline editing', default: 'ArrowDown' },
  { id: 'outline.notes', label: 'Open notes of heading', group: 'Outline editing', default: 'Shift+Enter' },
  { id: 'outline.collapse', label: 'Collapse / expand heading', group: 'Outline editing', default: 'Mod+.' },
  { id: 'outline.status', label: 'Cycle status', group: 'Outline editing', default: null },
  { id: 'outline.delete', label: 'Delete heading', group: 'Outline editing', default: null }
];

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown'
};
const MOD_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'OS']);

/** Normalise a key name: letters upper-case, aliases resolved. */
function normKey(k: string): string {
  if (k.length === 1) return k === ' ' ? 'Space' : k.toUpperCase();
  return KEY_ALIASES[k.toLowerCase()] ?? (/^f\d{1,2}$/i.test(k) ? k.toUpperCase() : k);
}

/** Canonical form: Mod+Alt+Shift+Key */
export function normalizeCombo(combo: string): string {
  const parts = combo.split('+');
  // allow "Mod++" (plus key)
  let key = parts.pop() ?? '';
  if (key === '' && combo.endsWith('+')) key = '+';
  const mods = new Set(parts.map((p) => p.trim().toLowerCase()));
  const out: string[] = [];
  if (mods.has('mod') || mods.has('ctrl') || mods.has('control') || mods.has('cmd') || mods.has('meta')) out.push('Mod');
  if (mods.has('alt') || mods.has('option')) out.push('Alt');
  if (mods.has('shift')) out.push('Shift');
  out.push(normKey(key));
  return out.join('+');
}

/** Combo string for a keyboard event (null for lone modifier presses). */
export function eventCombo(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MOD_KEYS.has(e.key)) return null;
  // Use physical code for letters/digits so Alt/Option combos work on macOS and other layouts.
  let key = e.key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  const out: string[] = [];
  if (e.ctrlKey || e.metaKey) out.push('Mod');
  if (e.altKey) out.push('Alt');
  if (e.shiftKey && (key.length > 1 || /[A-Za-z0-9]/.test(key) || out.length)) out.push('Shift');
  out.push(normKey(key));
  return out.join('+');
}

export function comboFor(id: string): string | null {
  const o = settings.shortcuts?.[id];
  if (o !== undefined) return o;
  return SHORTCUTS.find((s) => s.id === id)?.default ?? null;
}

/** " (Ctrl+K)" for tooltips, or "" when the action has no shortcut. */
export function hint(id: string): string {
  const c = comboFor(id);
  return c ? ` (${displayCombo(c)})` : '';
}

export function matches(e: KeyboardEvent, id: string): boolean {
  const c = comboFor(id);
  if (!c) return false;
  return eventCombo(e) === normalizeCombo(c);
}

/** Which action (if any) currently uses this combo. */
export function actionFor(combo: string, except?: string): ShortcutDef | undefined {
  const n = normalizeCombo(combo);
  return SHORTCUTS.find((s) => s.id !== except && comboFor(s.id) && normalizeCombo(comboFor(s.id)!) === n);
}

/** Assign; if `swap`, the conflicting action becomes unassigned. Returns the conflicting action. */
export function assign(id: string, combo: string | null, swap = false): ShortcutDef | undefined {
  const conflict = combo ? actionFor(combo, id) : undefined;
  if (conflict && !swap) return conflict;
  const next = { ...(settings.shortcuts ?? {}) };
  if (conflict) next[conflict.id] = null;
  const def = SHORTCUTS.find((s) => s.id === id)?.default ?? null;
  const val = combo ? normalizeCombo(combo) : null;
  if (val === (def && normalizeCombo(def))) delete next[id];
  else next[id] = val;
  settings.shortcuts = next;
  return conflict;
}

export function resetShortcut(id: string) {
  const next = { ...(settings.shortcuts ?? {}) };
  delete next[id];
  settings.shortcuts = next;
}
export function resetAllShortcuts() {
  settings.shortcuts = {};
}

/** Human-readable: "Ctrl+Shift+K" / "⌘⇧K". */
export function displayCombo(combo: string | null): string {
  if (!combo) return '';
  const parts = normalizeCombo(combo).split('+');
  const map: Record<string, string> = isMac
    ? { Mod: '⌘', Alt: '⌥', Shift: '⇧', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↵', Tab: '⇥', Backspace: '⌫', Escape: 'Esc' }
    : { Mod: 'Ctrl', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
  return parts.map((p) => map[p] ?? p).join(isMac ? '' : '+');
}
