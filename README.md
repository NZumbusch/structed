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

- **Zotero**: imports through the Web API (your library, groups and collections, plus PDF highlights and notes, which you review before importing), or from a file or pasted text (CSL-JSON, BibTeX/BibLaTeX, RIS, DOIs). When importing highlights you can filter by color and type, set a minimum length, and apply OCR/PDF cleanup (hyphenation, line breaks, ligatures, spacing, outer quotes). Highlights that were already imported are skipped.
- **Citations** use citation-js and CSL: APA, Chicago (author-date and notes), Harvard, MLA, DIN 1505-2 and Vancouver, in several languages.
- **Export**:
  - Markdown, with optional Obsidian callouts, footnotes, YAML front matter and a bibliography
  - Word (.docx)
  - BibTeX and CSL-JSON, either for the sources used in a project or for all of them
- **Backup and restore**: a full JSON file that includes images, imported by merging or by replacing.
- **Snapshots** save named versions of a project's structure, which you can restore later.
- **Search and command palette**: Ctrl+K.
- **Undo** with Ctrl+Z (when no text field has focus), plus undo toasts for destructive actions.
- **Settings**: light, dark, sepia or system theme, high contrast, accent color, text size, writing font, line width, reduced motion, and English or German.
- **Offline and installable**: a service worker plus a manifest, so it can be installed as an app on phones, tablets and desktops.
- **Google Drive sync** uses the hidden `appDataFolder`. Each item has its own timestamp and deletions are kept as tombstones, so offline edits on different devices merge without loss.

## Development

```bash
npm install
npm run dev      # http://localhost:5173/structed/
npm run check    # type check
npm run build    # production build in dist/
```

## Deploying to GitHub Pages

1. Repository **Settings → Pages → Source: GitHub Actions**.
2. Optionally, **Settings → Secrets and variables → Actions → Variables**: add `GOOGLE_CLIENT_ID` (see below). The ID is not a secret.
3. Push to `main`, or run the "Deploy to GitHub Pages" workflow manually. The app is then served at `https://<user>.github.io/structed/`.

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

Browser-only apps get Google access tokens that last about an hour. When a token expires, the sync icon turns amber and one click reconnects. Your data stays local and usable in the meantime.

## Zotero

Create a key at [zotero.org/settings/keys](https://www.zotero.org/settings/keys) with read access to your library, plus notes if you want them. Enter your numeric user ID and the key under **Settings → Zotero**. Only annotations that have been synced to zotero.org are available through the API.

## Architecture

- `src/lib/db.svelte.ts`: reactive entity store backed by IndexedDB, with undo/redo and last-write-wins merging per entity.
- `src/lib/sync.svelte.ts`: Google Identity Services token flow and the Drive REST API.
- `src/lib/dnd.ts`: pointer and touch drag-and-drop. Native HTML5 drag-and-drop does not work on iOS or Android.
- `src/lib/zotero.ts`, `cite.ts`, `ocr.ts`, `export.ts`, `backup.ts`: integrations.
- `src/stages/*`: the four stage views. `src/components/*`: UI pieces.
