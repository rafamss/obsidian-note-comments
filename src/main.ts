import {
  App,
  Editor,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  MarkdownPostProcessorContext,
  setIcon,
} from "obsidian";
import { EditorView } from "@codemirror/view";

import {
  DEFAULT_SETTINGS,
  PluginSettings,
  TextComment,
  resolveHighlight,
} from "./types";
import { CommentStore } from "./store";
import { findAnchor } from "./anchoring";
import {
  buildDecorations,
  commentDecoField,
  setCommentDecos,
} from "./decorations";
import { CommentsView, VIEW_TYPE_COMMENTS } from "./CommentsView";

export default class TextCommentsPlugin extends Plugin {
  settings: PluginSettings;
  store: CommentStore;

  /** The document currently in focus (read by the panel). */
  activeFile: TFile | null = null;
  activeComments: TextComment[] = [];
  activeText = "";

  /**
   * Last focused markdown editor. Kept even when the user clicks the
   * comments panel (which is not a MarkdownView), so comments stay
   * visible and editable.
   */
  activeMarkdownView: MarkdownView | null = null;

  /** Cache path -> comments, used by the reading-mode render. */
  private cache = new Map<string, TextComment[]>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new CommentStore(this.app, this.settings);

    // Keeps the comments folder out of search/quick-switcher/suggestions.
    this.ensureExcludedFolder();

    // 1. Highlight in the editor (Live Preview / Source).
    this.registerEditorExtension([commentDecoField]);

    // 2. Highlight in reading mode.
    this.registerMarkdownPostProcessor((el, ctx) =>
      this.highlightReadingMode(el, ctx)
    );

    // 3. Right side panel.
    this.registerView(
      VIEW_TYPE_COMMENTS,
      (leaf) => new CommentsView(leaf, this)
    );

    this.addRibbonIcon("message-square", "Comments", () =>
      this.activateView()
    );

    // 4. Context menu (right-click) on the selection.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view) => {
        if (!(view instanceof MarkdownView)) return;
        if (!editor.getSelection()) return;
        menu.addItem((item) =>
          item
            .setTitle("Add comment")
            .setIcon("message-square")
            .onClick(() => this.addComment(editor, view))
        );
      })
    );

    // 5. Commands.
    this.addCommand({
      id: "add-comment",
      name: "Add comment to selected passage",
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) void this.addComment(editor, view);
      },
    });
    this.addCommand({
      id: "open-panel",
      name: "Open comments panel",
      callback: () => this.activateView(),
    });

    // 6. Keep state in sync with the active document.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        // Only switches the focused document when the user enters a markdown
        // editor. Clicking the comments panel (or another panel)
        // keeps the current document visible and editable.
        if (leaf && leaf.view instanceof MarkdownView) {
          this.activeMarkdownView = leaf.view;
          void this.refreshActive();
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          this.activeMarkdownView = view;
          void this.refreshActive();
        }
      })
    );

    // 7. Clicks: on the widget (icon) opens the menu; on the highlighted passage, reveals it in the panel.
    this.registerDomEvent(activeDocument, "click", (evt) => {
      const target = evt.target as HTMLElement | null;

      const widget = target?.closest?.(
        ".text-comment-widget"
      ) as HTMLElement | null;
      if (widget) {
        const id = widget.getAttribute("data-comment-id");
        if (id) this.openCommentMenu(evt, id);
        return;
      }

      const span = target?.closest?.(
        ".text-comment-highlight"
      ) as HTMLElement | null;
      if (!span) return;
      const id = span.getAttribute("data-comment-id");
      if (id) void this.revealCommentInPanel(id);
    });

    this.addSettingTab(new TextCommentsSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.activeMarkdownView =
        this.app.workspace.getActiveViewOfType(MarkdownView);
      void this.refreshActive();
    });
  }

  onunload(): void {
    this.cache.clear();
  }

  // ---------------------------------------------------------------------------
  // State / synchronization
  // ---------------------------------------------------------------------------

  async refreshActive(): Promise<void> {
    const view = this.activeMarkdownView;
    const file = view?.file ?? null;
    this.activeFile = file;
    this.activeText = view?.editor.getValue() ?? "";

    if (file) {
      this.activeComments = await this.store.load(file);
      this.cache.set(file.path, this.activeComments);
    } else {
      this.activeComments = [];
    }

    this.applyDecorations(view);
    this.refreshPanel();
  }

  private applyDecorations(view: MarkdownView | null): void {
    if (!view) return;
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (!cm) return;
    const text = view.editor.getValue();
    cm.dispatch({
      effects: setCommentDecos.of(
        buildDecorations(text, this.activeComments, this.settings)
      ),
    });
  }

  private refreshPanel(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
      (leaf.view as CommentsView).render();
    }
  }

  // ---------------------------------------------------------------------------
  // Comment CRUD
  // ---------------------------------------------------------------------------

  async addComment(editor: Editor, view: MarkdownView): Promise<void> {
    const file = view.file;
    const selection = editor.getSelection();
    if (!file || !selection) {
      new Notice("Select a passage first.");
      return;
    }

    const fromOff = editor.posToOffset(editor.getCursor("from"));
    const toOff = editor.posToOffset(editor.getCursor("to"));
    const text = editor.getValue();
    const ctx = this.settings.contextLength;

    const body = await this.promptBody("");
    if (body === null) return; // cancelado

    const now = Date.now();
    const comment: TextComment = {
      id: genId(),
      quote: selection,
      prefix: text.slice(Math.max(0, fromOff - ctx), fromOff),
      suffix: text.slice(toOff, toOff + ctx),
      body,
      history: [{ at: now, action: "created" }],
      created: now,
      modified: now,
    };

    const comments = await this.store.load(file);
    comments.push(comment);
    await this.store.save(file, comments);
    await this.refreshActive();
    this.rerenderReadingView();
    new Notice("Comment added.");
  }

  async editComment(comment: TextComment): Promise<void> {
    if (!this.activeFile) return;
    const body = await this.promptBody(comment.body);
    if (body === null) return;
    const comments = await this.store.load(this.activeFile);
    const target = comments.find((c) => c.id === comment.id);
    if (!target) return;
    if (body === target.body) return; // no real change
    const now = Date.now();
    target.body = body;
    target.modified = now;
    target.history.push({ at: now, action: "edited" });
    await this.store.save(this.activeFile, comments);
    await this.refreshActive();
    this.rerenderReadingView();
  }

  async deleteComment(comment: TextComment): Promise<void> {
    if (!this.activeFile) return;
    const comments = (await this.store.load(this.activeFile)).filter(
      (c) => c.id !== comment.id
    );
    await this.store.save(this.activeFile, comments);
    await this.refreshActive();
    this.rerenderReadingView();
  }

  async toggleDone(comment: TextComment): Promise<void> {
    if (!this.activeFile) return;
    const comments = await this.store.load(this.activeFile);
    const target = comments.find((c) => c.id === comment.id);
    if (!target) return;
    const now = Date.now();
    target.done = !target.done;
    target.modified = now;
    target.history.push({ at: now, action: target.done ? "done" : "reopened" });
    await this.store.save(this.activeFile, comments);
    await this.refreshActive();
    this.rerenderReadingView();
  }

  scrollToComment(comment: TextComment): void {
    const view = this.activeMarkdownView;
    if (!view) return;

    // Reading mode: no editor — center on the rendered highlight.
    if (view.getMode() === "preview") {
      // Already visible? center directly.
      if (this.tryCenterHighlight(view, comment.id)) return;

      const data = view.getViewData();
      const range = findAnchor(data, comment);
      if (!range) {
        new Notice("Passage not found in the document.");
        return;
      }
      // Off-screen: force the section to render via its source line...
      view.setEphemeralState({ line: offsetToLine(data, range.from) });
      // ...and center once the highlight appears in the DOM.
      this.pollCenterHighlight(view, comment.id, 15);
      return;
    }

    // Edit mode (Source / Live Preview).
    const text = view.editor.getValue();
    const range = findAnchor(text, comment);
    if (!range) {
      new Notice("Passage not found in the document.");
      return;
    }
    const from = view.editor.offsetToPos(range.from);
    const to = view.editor.offsetToPos(range.to);
    view.editor.setSelection(from, to);

    // EditorView.scrollIntoView centers reliably even when the
    // passage is far away and the line hasn't been measured by CodeMirror yet.
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (cm) {
      cm.dispatch({
        effects: EditorView.scrollIntoView(range.from, { y: "center" }),
      });
    } else {
      view.editor.scrollIntoView({ from, to }, true);
    }
  }

  /** Centers on the highlight if it already exists in the DOM. Returns true if found. */
  private tryCenterHighlight(view: MarkdownView, id: string): boolean {
    const el = view.contentEl.querySelector<HTMLElement>(
      `.text-comment-highlight[data-comment-id="${id}"]`
    );
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    flashElement(el);
    return true;
  }

  /** Tries to center repeatedly until the lazy block is rendered. */
  private pollCenterHighlight(
    view: MarkdownView,
    id: string,
    attempts: number
  ): void {
    if (this.tryCenterHighlight(view, id)) return;
    if (attempts <= 0) return;
    window.setTimeout(() => this.pollCenterHighlight(view, id, attempts - 1), 40);
  }

  // ---------------------------------------------------------------------------
  // Reading mode
  // ---------------------------------------------------------------------------

  private async highlightReadingMode(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    let comments = this.cache.get(ctx.sourcePath);
    if (!comments) {
      // Cache not populated yet (e.g., document opened directly in reading mode).
      const f = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (f instanceof TFile) {
        comments = await this.store.load(f);
        this.cache.set(ctx.sourcePath, comments);
      }
    }
    if (!comments || comments.length === 0) return;
    for (const c of comments) {
      highlightInElement(el, c, this.settings);
    }
  }

  /** Re-renders reading mode to reflect added/removed comments. */
  private rerenderReadingView(): void {
    const view = this.activeMarkdownView;
    if (view && view.getMode() === "preview") {
      view.previewMode.rerender(true);
    }
  }

  /** Reapplies highlights after a color change in settings. */
  refreshAllHighlights(): void {
    void this.refreshActive();
    this.rerenderReadingView();
  }

  // ---------------------------------------------------------------------------
  // Helper UI
  // ---------------------------------------------------------------------------

  private promptBody(initial: string): Promise<string | null> {
    return new Promise((resolve) => {
      new CommentModal(this.app, initial, resolve).open();
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_COMMENTS, active: true });
    }
    if (leaf) await workspace.revealLeaf(leaf);
  }

  /** Opens the panel (if needed) and highlights the clicked comment's card. */
  async revealCommentInPanel(id: string): Promise<void> {
    await this.activateView();
    window.setTimeout(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
        (leaf.view as CommentsView).focusComment(id);
      }
    }, 50);
  }

  /** Action menu of a comment's inline (icon) widget. */
  openCommentMenu(evt: MouseEvent, id: string): void {
    const comment = this.activeComments.find((c) => c.id === id);
    if (!comment) return;

    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setIcon("message-square")
        .setTitle(truncate(comment.body || "Comment", 60))
        .setDisabled(true)
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setIcon("pencil")
        .setTitle("Edit")
        .onClick(() => this.editComment(comment))
    );
    menu.addItem((item) =>
      item
        .setIcon(comment.done ? "rotate-ccw" : "check-circle-2")
        .setTitle(comment.done ? "Mark as pending" : "Mark as completed")
        .onClick(() => this.toggleDone(comment))
    );
    menu.addItem((item) =>
      item
        .setIcon("panel-right")
        .setTitle("View in panel")
        .onClick(() => void this.revealCommentInPanel(id))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setIcon("trash-2")
        .setTitle("Delete")
        .setWarning(true)
        .onClick(() => this.deleteComment(comment))
    );
    menu.showAtMouseEvent(evt);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Adds the comments folder to Obsidian's "Excluded files", so that
   * the comment notes don't pollute search, quick switcher, link suggestions,
   * and "unlinked mentions". (Semi-internal `getConfig`/`setConfig` API.)
   */
  ensureExcludedFolder(): void {
    const folder = this.settings.commentsFolder.trim();
    if (!folder) return;
    const vault = this.app.vault as unknown as {
      getConfig?: (key: string) => unknown;
      setConfig?: (key: string, value: unknown) => void;
    };
    if (!vault.getConfig || !vault.setConfig) return;
    const current = vault.getConfig("userIgnoreFilters");
    const list = Array.isArray(current) ? (current as string[]) : [];
    if (!list.includes(folder)) {
      vault.setConfig("userIgnoreFilters", [...list, folder]);
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Shortens a text into a one-line preview. */
function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/**
 * Highlights the passage in the rendered DOM (one block/`el` per call).
 *
 * Layered strategy:
 *   1. the whole passage (common case, fits in a single block);
 *   2. the whole passage without markdown syntax (e.g., "# Day 1" -> "Day 1");
 *   3. if the selection spans blocks (heading + paragraph, etc.), tries
 *      **line by line** — each block highlights the line(s) it contains.
 */
function highlightInElement(
  root: HTMLElement,
  c: TextComment,
  settings: PluginSettings
): void {
  if (!c.quote) return;

  // 1 + 2: whole passage (exact and without markdown).
  const whole = tryMatch(root, c.quote, c, settings);
  if (whole) {
    appendCommentIcon(whole, c);
    return;
  }

  // 3: multi-line passage (spans blocks). Try each line in this block.
  const lines = c.quote
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1) return; // already tried as a single passage
  let last: HTMLElement | null = null;
  for (const line of lines) {
    const el = tryMatch(root, line, c, settings);
    if (el) last = el;
  }
  if (last) appendCommentIcon(last, c);
}

/** Tries to match `text` (exact) and, failing that, its version without markdown. */
function tryMatch(
  root: HTMLElement,
  text: string,
  c: TextComment,
  settings: PluginSettings
): HTMLElement | null {
  const el = wrapFirstOccurrence(root, text, c, settings);
  if (el) return el;
  const stripped = stripMarkdown(text);
  if (stripped && stripped !== text) {
    return wrapFirstOccurrence(root, stripped, c, settings);
  }
  return null;
}

/** Inserts the clickable icon (same as the editor's) right after the highlighted passage. */
function appendCommentIcon(afterEl: HTMLElement, c: TextComment): void {
  const next = afterEl.nextElementSibling;
  if (
    next &&
    next.classList.contains("text-comment-widget") &&
    next.getAttribute("data-comment-id") === c.id
  ) {
    return; // already exists (avoids duplicates on reprocessing)
  }
  const icon = activeDocument.createElement("span");
  icon.className = "text-comment-widget" + (c.done ? " is-done" : "");
  icon.setAttribute("data-comment-id", c.id);
  icon.setAttribute("aria-label", c.body || "Comment");
  setIcon(icon, "message-square");
  afterEl.insertAdjacentElement("afterend", icon);
}

/** Removes the markdown syntax that doesn't appear in the rendered text. */
function stripMarkdown(s: string): string {
  return s
    .replace(/^\s*#{1,6}\s+/, "") // headings
    .replace(/^\s*>+\s?/, "") // blockquote
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "") // list
    .replace(/\*\*|__|~~|==/g, "") // bold / strikethrough / highlight
    .replace(/[*_`]/g, "") // emphasis / code
    .trim();
}

/**
 * Wraps the first occurrence of `searchText` in the DOM, even if it spans
 * multiple text nodes (e.g., a sentence with **bold** in the middle).
 * Returns the rightmost `span` of the highlight (or null if not found).
 */
function wrapFirstOccurrence(
  root: HTMLElement,
  searchText: string,
  c: TextComment,
  settings: PluginSettings
): HTMLElement | null {
  const quote = searchText;
  if (!quote) return null;

  // Collects the text nodes not yet highlighted, in order.
  const nodes: Text[] = [];
  const walker = activeDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(".text-comment-highlight")) {
      continue;
    }
    nodes.push(node as Text);
  }

  const full = nodes.map((n) => n.nodeValue ?? "").join("");
  const idx = full.indexOf(quote);
  if (idx === -1) return null;
  const end = idx + quote.length;

  // Maps the global range to local segments (node, start, end).
  const segments: Array<{ node: Text; start: number; end: number }> = [];
  let pos = 0;
  for (const n of nodes) {
    const len = (n.nodeValue ?? "").length;
    const segStart = Math.max(idx, pos);
    const segEnd = Math.min(end, pos + len);
    if (segStart < segEnd) {
      segments.push({ node: n, start: segStart - pos, end: segEnd - pos });
    }
    pos += len;
    if (pos >= end) break;
  }

  const { color, done } = resolveHighlight(c, settings);

  // Wraps each segment (back to front, so offsets stay valid).
  // Since we go right to left, the first success is the rightmost one.
  let rightmost: HTMLElement | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    try {
      const range = activeDocument.createRange();
      range.setStart(s.node, s.start);
      range.setEnd(s.node, s.end);
      const span = activeDocument.createElement("span");
      span.className = done
        ? "text-comment-highlight is-done"
        : "text-comment-highlight";
      span.setAttribute("data-comment-id", c.id);
      // Obsidian tooltip (follows theme/typography), not the native `title` attribute.
      if (c.body) span.setAttribute("aria-label", c.body);
      if (color) span.setAttribute("style", `--tc-color: ${color}`);
      range.surroundContents(span);
      if (!rightmost) rightmost = span;
    } catch {
      // Invalid segment; ignore it.
    }
  }
  return rightmost;
}

/** Converts a character offset into a line number (0-based). */
function offsetToLine(text: string, offset: number): number {
  let line = 0;
  const limit = Math.min(offset, text.length);
  for (let i = 0; i < limit; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Briefly highlights an element when navigating to it. */
function flashElement(el: HTMLElement): void {
  el.classList.add("text-comment-flash");
  window.setTimeout(() => el.classList.remove("text-comment-flash"), 1200);
}

// -----------------------------------------------------------------------------
// Edit modal
// -----------------------------------------------------------------------------

class CommentModal extends Modal {
  constructor(
    app: App,
    private initial: string,
    private onSubmit: (value: string | null) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Comment" });

    const ta = contentEl.createEl("textarea", {
      cls: "text-comment-input",
    });
    ta.value = this.initial;
    ta.rows = 5;

    const row = contentEl.createDiv({ cls: "text-comment-modal-actions" });
    const save = row.createEl("button", { text: "Save", cls: "mod-cta" });
    save.onclick = () => {
      this.resolved = true;
      this.onSubmit(ta.value.trim());
      this.close();
    };
    const cancel = row.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();

    window.setTimeout(() => ta.focus(), 0);
  }

  private resolved = false;

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.onSubmit(null);
  }
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

class TextCommentsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TextCommentsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Comments folder")
      .setDesc(
        "Where the comment notes are saved. The folder is automatically kept out of search and the quick switcher."
      )
      .addText((text) =>
        text
          .setPlaceholder("Comments")
          .setValue(this.plugin.settings.commentsFolder)
          .onChange(async (value) => {
            this.plugin.settings.commentsFolder = value.trim() || "Comments";
            await this.plugin.saveSettings();
            this.plugin.ensureExcludedFolder();
          })
      );

    new Setting(containerEl)
      .setName("Anchor context")
      .setDesc(
        "How many characters before/after the passage to store so it can be relocated after edits."
      )
      .addSlider((slider) =>
        slider
          .setLimits(8, 80, 4)
          .setValue(this.plugin.settings.contextLength)
          .onChange(async (value) => {
            this.plugin.settings.contextLength = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default panel sorting")
      .addDropdown((dd) =>
        dd
          .addOption("position-asc", "Position ↑")
          .addOption("position-desc", "Position ↓")
          .addOption("created-asc", "Oldest first")
          .addOption("created-desc", "Newest first")
          .setValue(this.plugin.settings.defaultSort)
          .onChange(async (value) => {
            this.plugin.settings.defaultSort = value as PluginSettings["defaultSort"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Highlight colors").setHeading();

    this.colorSetting(
      containerEl,
      "Pending",
      "pendingColor",
      "Highlight for comments not yet completed. Empty = theme default.",
      "#ffd966"
    );

    this.colorSetting(
      containerEl,
      "Completed",
      "doneColor",
      "Highlight for comments marked as completed.",
      "#4caf50"
    );
  }

  /** Settings row with a color picker and a reset-to-theme button. */
  private colorSetting(
    container: HTMLElement,
    name: string,
    key: "pendingColor" | "doneColor",
    desc: string,
    fallback: string
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc(desc)
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings[key] || fallback)
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
            this.plugin.refreshAllHighlights();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Theme default")
          .onClick(async () => {
            this.plugin.settings[key] = "";
            await this.plugin.saveSettings();
            this.plugin.refreshAllHighlights();
            this.display();
          })
      );
  }
}
