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
  { open: () => !!ui.reviewSources, close: () => (ui.reviewSources = null) },
  { open: () => ui.wordExport, close: () => (ui.wordExport = false) },
  { open: () => !!ui.selection, close: () => ui.selection?.() },
  { open: () => ui.panelMobileOpen && ui.narrow, close: () => (ui.panelMobileOpen = false) },
  // an open source on a phone (the list and the source are separate screens there)
  { open: () => ui.narrow && !!ui.collectSourceId && (ui.libraryMode || ui.stage === 'collect'), close: () => (ui.collectSourceId = null) },
  { open: () => ui.libraryMode && !ui.projectId, close: () => (ui.libraryMode = false) }
];

export function startBackHandling() {
  // Each history entry we push carries its position (1, 2, …) in `history.state.structed`.
  // We always read the real position from there instead of counting, so the mirror
  // corrects itself and a back step can never leave the app.
  const pos = () => (history.state?.structed as number | undefined) ?? 0;
  let skip = 0; // our own history.go() calls to ignore
  const count = () => LAYERS.filter((l) => l.open()).length;

  function sync(n = count()) {
    const at = pos();
    if (n > at) {
      for (let i = at + 1; i <= n; i++) history.pushState({ structed: i }, '');
    } else if (n < at && !skip) {
      // closed with a button: take back the history entries it had (never more than ours)
      skip++;
      history.go(-(at - n));
    }
  }

  addEventListener('popstate', () => {
    if (skip) {
      skip--;
      sync(); // something may have opened meanwhile
      return;
    }
    // a back step: close the innermost open thing, if the history now has fewer entries than open layers
    if (count() > pos()) LAYERS.find((l) => l.open())?.close();
    queueMicrotask(() => sync());
  });

  $effect.root(() => {
    $effect(() => {
      sync(count());
    });
  });
}
