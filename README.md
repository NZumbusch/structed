# Structed

A minimalist, local-first web app and PWA for structuring essays, seminar papers, theses and journal articles.
You build the outline, collect quotes from your sources, place them under headings, and then write with everything at hand.

## Workflow: four stages (switch with Alt+1…4)

| Stage | What you do |
|---|---|
| **Outline** | Build headings and subheadings to any depth, like an outliner (Enter, Tab, Shift+Tab, Alt+↑/↓, Ctrl+.). Each heading can hold markdown notes for its gist, a status (idea, draft, revise, done) and a word target. |
| **Collect** | Manage sources (Zotero or manual) and quickly capture quotes, paraphrases, notes and images with page numbers, comments and tags. Bulk tools clean OCR text, retag, change type or delete. |
| **Arrange** | Drag items from the library panel onto headings with a mouse, or long-press on touch. One item can sit under several headings, and each placement can carry a "why here" note. Dragging an item back onto the panel removes it from the heading. |
| **Write** | A document-style overview with a table of contents, rendered texts edited in place, expandable quotes, comments per section, and one-click **Copy with citation**. |

The **library panel** is available in every stage. It groups items by source, author, tag/topic, kind, publication or year, and it can search and filter (for example "unused in this project").

## Features

- **Zotero**: imports through the Web API (your library, groups and collections, plus PDF highlights and notes, which you review before importing), or from a file or pasted text (CSL-JSON, BibTeX/BibLaTeX, RIS, DOIs). When importing highlights you can filter by color and type, set a minimum length, and apply OCR/PDF cleanup (hyphenation, line breaks, ligatures, spacing, outer quotes). Highlights that were already imported are skipped. **Automatic sync** (Settings → Zotero) keeps the sources of a library or collection up to date. It runs when the app starts, when you return to it and every 10 minutes, and asks Zotero only for changes. Sources you deleted here are not imported again unless you pick them explicitly.
- **Citations** use citation-js and CSL: APA, Chicago (author-date and notes), Harvard, MLA, DIN 1505-2 and Vancouver, in several languages.
- **Export**:
  - Markdown, with optional Obsidian callouts, footnotes, YAML front matter and a bibliography
  - Word (.docx)
  - BibTeX and CSL-JSON, either for the sources used in a project or for all of them
- **Backup and restore**: a full JSON file that includes images, imported by merging or by replacing.
- **Snapshots** save named versions of a project's structure, which you can restore later.
- **Focus mode** in the Write stage (Ctrl+Shift+F, Esc to leave): only your text, with no header, panel or toolbar. The section notes and the library panel (quotes) can each be toggled back in. Extras: dimming everything except the current paragraph, typewriter scrolling, full screen, a word goal per session, and writing sprints (10–60 min). The controls fade out while you type and come back when you move the mouse. Outside focus mode, the notes under each heading can be toggled too. Ctrl+Alt+↓ / ↑ jumps to the start of the next or previous section, both in focus mode and outside it. Every button in the Write toolbar and the focus bar has a shortcut in Settings → Keyboard shortcuts: notes (Ctrl+Alt+N), quotes panel (Ctrl+\\), and the rest unassigned until you set them.
- **Search and command palette**: Ctrl+K.
- **Undo** with Ctrl+Z (when no text field has focus), plus undo toasts for destructive actions.
- **Settings**: light, dark, sepia or system theme, high contrast, accent color, text size, writing font, line width, reduced motion, and English or German.
- **Offline and installable**: a service worker plus a manifest, so it can be installed as an app on phones, tablets and desktops.
- **Google Drive sync** uses the hidden `appDataFolder`. Each item has its own timestamp and deletions are kept as tombstones, so offline edits on different devices merge without loss.

## Development

```bash
npm install
npm run dev        # http://localhost:5173/structed/
npm run check      # type check
npm run build      # production build in dist/
npm test           # unit + end-to-end tests
npm run test:unit  # Vitest only (fast)
npm run test:e2e   # Playwright only
```

## Tests

Tests are the safety net for every change. CI runs them for `main`, release tags and pull requests (browser tests in the official Playwright container, split into two parallel shards), and **deploys only happen when everything passes**. When bumping `@playwright/test`, update the container tag in `.github/workflows/ci.yml` to the same version.

| Layer | Tool | Covers |
|---|---|---|
| Unit (`tests/unit`) | Vitest + fake IndexedDB | Data store (persistence, last-write-wins merge, tombstones, undo/redo and nested batches), outline operations (indent, move, split at the caret, cascade delete), placements, labels and word counts, OCR cleanup, BibTeX/RIS/CSL parsing, APA citations, Markdown export, shortcut parsing and conflicts, version scheme |
| End-to-end (`tests/e2e`) | Playwright | Every workflow in a real browser: keyboard outlining, collecting quotes, Zotero Web API (mocked) with highlight review, drag & drop (mouse and touch long-press), the place picker, Write view, comments, citation copy, search, export (md/docx/bib), backup round-trip, snapshots, two-device Google Drive sync (mocked, including images and expired sessions), PWA offline mode, German UI, shortcuts and the tour |
| Accessibility | axe-core | WCAG 2.1 AA (contrast, labels, names) in every theme (light, dark, sepia, high contrast light/dark), on every stage and dialog, at desktop, tablet and phone sizes |
| Layout | Playwright | No horizontal overflow with very long words and URLs, line breaks preserved in quotes and texts, wrapping editors, two-line clamping of collapsed cards, touch-target sizes on phones |

Tests run in three viewports: desktop at 1400px, tablet at 820px with touch, and phone at 390px with touch.

## Versioning

Stable releases are **git tags** such as `v1.0` or `v2.0`. Every build between releases is numbered from the most recent tag: the last number counts the commits since then, followed by the commit hash.

| State | Shown in Settings → About |
|---|---|
| on tag `v1.0` | `1.0` |
| 7 commits after `v1.0` | `1.0.7 (abc1234) · development build` |
| no tag yet | `0.0.<total commits> (hash)` |

To promote a release, tag a commit and push the tag (CI tests it, then deploys it):

```bash
git tag v1.0 && git push origin v1.0
```

## Keyboard shortcuts & tour

Shortcuts can be changed under **Settings → Keyboard shortcuts**:
- Click a shortcut, then press the new keys. Esc cancels and Backspace removes the shortcut.
- If the keys are already in use, a warning lets you reassign them (the other action becomes unassigned) or cancel.
- Many extra actions (new quote/note/source, export, sync, theme toggle…) are available but unassigned by default.

The **guided tour** starts on first use and spotlights each part of the app. If you have no project yet, it creates a demo project, which you can keep or remove afterwards. You can restart the tour from Settings → About & help.

## Deploying to GitHub Pages

1. Repository **Settings → Pages → Source: GitHub Actions**.
2. Optionally, **Settings → Secrets and variables → Actions → Variables**: add `GOOGLE_CLIENT_ID` (see below). The ID is not a secret.
3. Push to `main` (or push a `v*` tag). The "CI & Deploy" workflow runs all tests and deploys only if they pass. The app is then served at `https://<user>.github.io/structed/`.

For a custom domain, build with `BASE=/`.

## Google Drive sync setup (free)

1. Go to [console.cloud.google.com](https://console.cloud.google.com/projectcreate) and create a project.
2. Under APIs & Services → Library, enable the **Google Drive API**.
3. Configure the OAuth consent screen / Google Auth Platform:
   - Choose External.
   - Under Data access, add the scope `https://www.googleapis.com/auth/drive.appdata`. It is non-sensitive, so no verification is needed.
   - Add yourself as a test user, or publish the app.
4. Under Clients → Create client, choose **Web application** and add these *Authorized JavaScript origins*:
   - `https://<user>.github.io`
   - `http://localhost:5173` (for development)
5. Put the client ID in the `GOOGLE_CLIENT_ID` repository variable, or paste it in the app under **Settings → Sync**.

### Staying signed in

Browser-only apps get Google access tokens that last about an hour. Structed handles this in one of two ways:

- **Without extra setup:** Structed syncs just before the token expires. Afterwards the sync icon shows *paused*, and your **next click** anywhere renews the session automatically: a Google window flashes and closes by itself. Typing never triggers it, and a blocked popup is not retried. You can turn this off in Settings → Sync.
- **With the optional auth server** (a free Cloudflare Worker, see [`worker/README.md`](worker/README.md)): the app refreshes its access silently in the background and stays signed in for months with no popups.

## Public pages (homepage, privacy policy, terms)

These pages are needed to publish the Google OAuth app (moving it out of "Testing"):

| Page | URL |
|---|---|
| Homepage | `https://nzumbusch.github.io/structed/about.html` |
| Privacy policy | `https://nzumbusch.github.io/structed/privacy.html` |
| Terms of use | `https://nzumbusch.github.io/structed/terms.html` |

They are in English and German. The name, contact email and date live in `legal.config.json`. For Google branding verification, set the repository variable `GOOGLE_SITE_VERIFICATION` to the token from Search Console's "HTML tag" method; it is injected as a meta tag into every page.

## Zotero

Create a key at [zotero.org/settings/keys](https://www.zotero.org/settings/keys) with read access to your library, plus notes if you want them. Enter your numeric user ID and the key under **Settings → Zotero**. Only annotations that have been synced to zotero.org are available through the API.

## Architecture

- `src/lib/db.svelte.ts`: reactive entity store backed by IndexedDB, with undo/redo and last-write-wins merging per entity.
- `src/lib/sync.svelte.ts`: Google Identity Services token flow and the Drive REST API.
- `src/lib/dnd.ts`: pointer and touch drag-and-drop. Native HTML5 drag-and-drop does not work on iOS or Android.
- `src/lib/zotero.ts`, `cite.ts`, `ocr.ts`, `export.ts`, `backup.ts`: integrations.
- `src/stages/*`: the four stage views. `src/components/*`: UI pieces.
