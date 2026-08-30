# Note Comments — Obsidian plugin

Adds anchored comments to any passage of text (a word, phrase, or paragraph),
with **colored highlight + underline** tied to the theme, and a **side panel**
with sorting.

![Document with commented passages and the side comments panel](docs/images/overview.png)

## Features

- **Comment via right-click**: select a passage → context menu →
  *Add comment*. Also available as a command.
- **Highlight** of the passage with background (`--text-highlight-bg`) and
  underline (`--text-accent`) — respects light/dark theme. Works in Live
  Preview, Source, and reading mode.
- **Panel on the right** listing all comments of the document, with
  ascending/descending sort by **position** or **date**.
- **Clean document**: nothing is inserted into your markdown. The anchor is the
  passage itself + context, relocated automatically (in the style of *text
  quote selector*). If a passage is heavily rewritten, the comment becomes an
  "orphan" (shown dimmed in the panel) instead of silently getting lost.
- **Storage**: one note per document, inside the configurable folder, mirroring
  the source path and with a `[[document]]` backlink. The note is
  human-readable (callouts) and has a hidden `%% ... %%` block with the JSON,
  which is the source of truth.

## Screenshots

**Panel with history** — each comment keeps the `created → edited → completed`
trail; completed ones appear struck through.

![Comments panel with the history trail](docs/images/panel.png)

**Filter completed** — the eye icon hides resolved comments, leaving only
pending ones.

![Panel filtering only pending comments](docs/images/filter.png)

**Sorting** — by position in the document or by date (oldest first / newest
first).

![Panel sorting menu](docs/images/sort.png)

**Configurable** — notes folder, anchor context length, default sorting, and
the highlight colors (pending / completed).

![Plugin settings screen](docs/images/settings.png)

## How the anchor works

When commenting, we store `quote` (the passage), `prefix`, and `suffix` (a few
characters around it). To highlight, we relocate its position in the current
text:

1. exact match of `prefix + quote + suffix`;
2. if the passage occurs multiple times, we pick the one with the most similar
   context;
3. if it no longer exists, the comment becomes an orphan.

While editing, the highlights move along with the text (CodeMirror decoration
mapping), so relocation is only used when reopening.

## Development

```bash
npm install
npm run dev     # build with watch
npm run build   # production build + type-check
```

To test: copy `main.js`, `manifest.json`, and `styles.css` to
`<vault>/.obsidian/plugins/note-comments/` and enable the plugin.

## Known limitations (v0.1)

- In reading mode, we highlight the **first occurrence** of the passage within
  each block and only when it fits in a single text node (no formatting in the
  middle).
- Relocation is by exact text; large rewrites of the passage create orphans.
- One color per highlight is supported in the data model (`color`), but there is
  no UI to pick it yet.
