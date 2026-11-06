// The phone's back gesture (and the browser's back button) closes the innermost thing
// that is open – a dialog, the library drawer, an open source, the library itself –
// instead of leaving the app. Each open layer is mirrored by one history entry.
import { ui } from './ui.svelte';
import { editorState } from './editorState.svelte';

interface Layer {
  open: () => boolean;
  close: () => void;
}

// innermost first
const LAYERS: Layer[] = [
  { open: () => !!ui.question, close: () => ui.question?.answer(false) },
  { open: () => !!ui.contextMenu, close: () => (ui.contextMenu = null) },
  { open: () => !!editorState.footnote, close: () => (editorState.footnote = null) },
  { open: () => !!ui.placeTarget, close: () => (ui.placeTarget = null) },
  { open: () => !!ui.editArtifact, close: () => (ui.editArtifact = null) },
  { open: () => !!ui.editSource, close: () => (ui.editSource = null) },
  { open: () => !!ui.dialog, close: () => (ui.dialog = null) },
  { open: () => ui.wordExport, close: () => (ui.wordExport = false) },
  { open: () => !!ui.selection, close: () => ui.selection?.() },
  { open: () => ui.panelMobileOpen && ui.narrow, close: () => (ui.panelMobileOpen = false) },
  // an open source on a phone (the list and the source are separate screens there)
  { open: () => ui.narrow && !!ui.collectSourceId && (ui.libraryMode || ui.stage === 'collect'), close: () => (ui.collectSourceId = null) },
  { open: () => ui.libraryMode && !ui.projectId, close: () => (ui.libraryMode = false) }
];

export function startBackHandling() {
  let depth = 0; // history entries we pushed
  let skip = 0; // our own history.go() calls to ignore
  const count = () => LAYERS.filter((l) => l.open()).length;

  addEventListener('popstate', () => {
    if (skip) {
      skip--;
      return;
    }
    depth = Math.max(0, depth - 1);
    LAYERS.find((l) => l.open())?.close();
  });

  $effect.root(() => {
    $effect(() => {
      const n = count();
      if (n > depth) {
        for (; depth < n; depth++) history.pushState({ structed: depth + 1 }, '');
      } else if (n < depth) {
        // closed with a button: take back the history entries it had
        skip++;
        history.go(n - depth);
        depth = n;
      }
    });
  });
}
