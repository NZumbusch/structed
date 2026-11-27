// The Write editor's typing helpers for plain text fields (quotes, comments, notes,
// titles): typographic quotes and apostrophes, … for "...", " - " → " – ", non-breaking
// spaces after "S.", "§" and inside "z. B.", Ctrl+Shift+Space for a non-breaking space,
// Backspace right after an automatic change undoes it, and spell check in the text's
// language. All of it follows the same settings as the main editor.
import { settings, textLang } from './settings.svelte';
import { AUTO_DASH, NBSP, NBSP_BEFORE, NBSP_INNER, OPENS_AFTER, typedQuotes } from './typing';

export interface AutoChange {
  /** index in `before` from which the text is replaced */
  from: number;
  /** the new text for before.slice(from) + the typed character */
  insert: string;
}

/**
 * What typing `ch` after `before` (the text up to the caret) turns into, or null when it
 * stays as typed. `markdown`: a line that starts with " - " is a list, not a dash.
 */
export function autoType(before: string, ch: string, opts: { markdown?: boolean } = {}): AutoChange | null {
  if (ch.length !== 1) return null;
  const off = before.lastIndexOf('\n') + 1;
  let text = before.slice(off);
  let typed = ch;
  let from = text.length;

  if (settings.editorAutoDash) {
    const m = AUTO_DASH.exec(text + ch);
    if (m) {
      const dash = m.index + m[0].indexOf(' -') + 1;
      const list = opts.markdown && /^\s*$/.test(text.slice(0, dash - 1));
      if (!list) {
        text = text.slice(0, dash) + '–' + text.slice(dash + 1);
        from = Math.min(from, dash);
      }
    }
  }
  if (settings.editorSmartQuotes) {
    if (ch === '"' || ch === "'") {
      const single = ch === "'";
      const prev = text.slice(-1);
      const [od, cd, os, cs] = typedQuotes();
      if (single && /[\p{L}\p{N}]/u.test(prev)) typed = '’';
      else if (OPENS_AFTER.test(prev) && !(single ? [cs, '’'] : [cd]).includes(prev)) typed = single ? os : od;
      else typed = single ? cs : cd;
    } else if (ch === '.' && text.endsWith('..')) {
      text = text.slice(0, -2);
      typed = '…';
      from = Math.min(from, text.length);
    }
  }
  if (settings.editorNbsp) {
    if (ch === ' ' && NBSP_BEFORE.test(text + ' ')) typed = NBSP;
    else if (ch === '.') {
      const m = NBSP_INNER.exec(text + '.');
      if (m) {
        const at = m.index + 2;
        text = text.slice(0, at) + NBSP + text.slice(at + 1);
        from = Math.min(from, at);
      }
    }
  }
  if (typed === ch && from === text.length) return null;
  return { from: off + from, insert: text.slice(from) + typed };
}

/** Replace [start, end) of a text field, keeping the browser's undo where it can. */
function replaceRange(el: HTMLTextAreaElement | HTMLInputElement, start: number, end: number, text: string) {
  el.setSelectionRange(start, end);
  let done = false;
  try {
    done = document.execCommand('insertText', false, text);
  } catch {
    done = false;
  }
  if (!done || el.value.slice(start, start + text.length) !== text) {
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Svelte action for a textarea or text input with prose in it: the same typing helpers as
 * the Write editor. Spell check and language follow the settings unless set on the element.
 */
export function prose(el: HTMLTextAreaElement | HTMLInputElement) {
  /** the last automatic change: Backspace right after it brings back what was typed */
  let last: { at: number; was: string; now: string } | null = null;
  const ownSpell = el.hasAttribute('spellcheck');
  const ownLang = el.hasAttribute('lang');
  if (!ownSpell) el.spellcheck = settings.editorSpellcheck;
  if (!ownLang) el.lang = textLang();

  let busy = false; // our own insertText fires beforeinput again
  const onBeforeInput = (e: InputEvent) => {
    if (busy) return;
    if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1 || e.isComposing) {
      if (e.inputType !== 'deleteContentBackward') last = null;
      return;
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const r = autoType(el.value.slice(0, start), e.data);
    last = null;
    if (!r) return;
    e.preventDefault();
    const was = el.value.slice(r.from, start) + e.data;
    busy = true;
    try {
      replaceRange(el, r.from, end, r.insert);
    } finally {
      busy = false;
    }
    last = { at: r.from + r.insert.length, was, now: r.insert };
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === ' ' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      const s = el.selectionStart ?? 0;
      busy = true;
      try {
        replaceRange(el, s, el.selectionEnd ?? s, NBSP);
      } finally {
        busy = false;
      }
      last = null;
      return;
    }
    if (e.key === 'Backspace' && last && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const { at, was, now } = last;
      last = null;
      if (el.selectionStart === at && el.selectionEnd === at && el.value.slice(at - now.length, at) === now) {
        e.preventDefault();
        busy = true;
        try {
          replaceRange(el, at - now.length, at, was);
        } finally {
          busy = false;
        }
      }
    } else if (e.key.length > 1 && e.key !== 'Shift') last = null; // arrows, Home, Enter…
  };
  const forget = () => (last = null);
  (el as HTMLElement).addEventListener('beforeinput', onBeforeInput);
  (el as HTMLElement).addEventListener('keydown', onKeyDown);
  (el as HTMLElement).addEventListener('pointerdown', forget);
  return {
    destroy() {
      (el as HTMLElement).removeEventListener('beforeinput', onBeforeInput);
      (el as HTMLElement).removeEventListener('keydown', onKeyDown);
      (el as HTMLElement).removeEventListener('pointerdown', forget);
    }
  };
}
