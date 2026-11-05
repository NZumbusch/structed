import { describe, expect, it } from 'vitest';
import { settings } from '../../src/lib/settings.svelte';
import {
  SHORTCUTS,
  actionFor,
  assign,
  comboFor,
  eventCombo,
  normalizeCombo,
  resetAllShortcuts,
  resetShortcut
} from '../../src/lib/shortcuts';

const ev = (key: string, code = '', mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
});

describe('shortcuts', () => {
  it('normalises combos', () => {
    expect(normalizeCombo('shift+ctrl+k')).toBe('Mod+Shift+K');
    expect(normalizeCombo('Cmd+Alt+1')).toBe('Mod+Alt+1');
    expect(normalizeCombo('alt+up')).toBe('Alt+ArrowUp');
  });
  it('builds combos from events, using physical keys for letters/digits', () => {
    expect(eventCombo(ev('k', 'KeyK', { ctrlKey: true }))).toBe('Mod+K');
    expect(eventCombo(ev('K', 'KeyK', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+K');
    // macOS Option+1 produces "¡"
    expect(eventCombo(ev('¡', 'Digit1', { altKey: true }))).toBe('Alt+1');
    expect(eventCombo(ev('Tab', 'Tab', { shiftKey: true }))).toBe('Shift+Tab');
    expect(eventCombo(ev('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull();
    expect(eventCombo(ev('?', 'Slash', { shiftKey: true }))).toBe('?');
  });
  it('has unique default combos', () => {
    const defs = SHORTCUTS.map((s) => s.default).filter(Boolean).map((c) => normalizeCombo(c!));
    expect(new Set(defs).size).toBe(defs.length);
  });
  it('offers extra actions that are unassigned by default', () => {
    expect(SHORTCUTS.filter((s) => s.default === null).length).toBeGreaterThan(5);
  });
  it('assigns, detects conflicts and swaps', () => {
    resetAllShortcuts();
    expect(assign('newQuote', 'Mod+Shift+Q')).toBeUndefined();
    expect(comboFor('newQuote')).toBe('Mod+Shift+Q');
    // conflict without swap: nothing changes
    const c = assign('newNote', 'Mod+K');
    expect(c?.id).toBe('search');
    expect(comboFor('newNote')).toBeNull();
    expect(comboFor('search')).toBe('Mod+K');
    // swap: search becomes unassigned
    assign('newNote', 'Mod+K', true);
    expect(comboFor('newNote')).toBe('Mod+K');
    expect(comboFor('search')).toBeNull();
    expect(actionFor('ctrl+k')?.id).toBe('newNote');
  });
  it('resets single and all shortcuts', () => {
    assign('search', 'Mod+P');
    resetShortcut('search');
    expect(comboFor('search')).toBe('Mod+K');
    assign('undo', null);
    expect(comboFor('undo')).toBeNull();
    resetAllShortcuts();
    expect(settings.shortcuts).toEqual({});
    expect(comboFor('undo')).toBe('Mod+Z');
  });
  it('assigning the default again removes the override', () => {
    resetAllShortcuts();
    assign('search', 'Mod+P');
    assign('search', 'Mod+K');
    expect(settings.shortcuts).toEqual({});
  });
});
