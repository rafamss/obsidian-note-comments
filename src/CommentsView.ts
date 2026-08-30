import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { SortKey, TextComment, formatTimestamp } from "./types";
import { findAnchor } from "./anchoring";
import type TextCommentsPlugin from "./main";

export const VIEW_TYPE_COMMENTS = "note-comments-view";

export class CommentsView extends ItemView {
  private plugin: TextCommentsPlugin;
  private sort: SortKey;
  private hideDone = false;

  constructor(leaf: WorkspaceLeaf, plugin: TextCommentsPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.sort = plugin.settings.defaultSort;
  }

  getViewType(): string {
    return VIEW_TYPE_COMMENTS;
  }

  getDisplayText(): string {
    return "Comments";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  /** Recomputes and redraws the list. Called by the plugin when something changes. */
  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-comments-panel");

    const file = this.plugin.activeFile;
    const comments = this.plugin.activeComments;

    // Header with sorting controls.
    const header = contentEl.createDiv({ cls: "note-comments-header" });
    header.createEl("div", {
      cls: "note-comments-title",
      text: file ? file.basename : "No document",
    });

    const select = header.createEl("select", { cls: "dropdown" });
    const options: Array<[SortKey, string]> = [
      ["position-asc", "Position ↑"],
      ["position-desc", "Position ↓"],
      ["created-asc", "Oldest first"],
      ["created-desc", "Newest first"],
    ];
    for (const [value, label] of options) {
      const opt = select.createEl("option", { text: label });
      opt.value = value;
      if (value === this.sort) opt.selected = true;
    }
    select.onchange = () => {
      this.sort = select.value as SortKey;
      this.render();
    };

    // Button to hide/show completed comments.
    const toggleDone = header.createEl("button", { cls: "clickable-icon" });
    setIcon(toggleDone, this.hideDone ? "eye-off" : "eye");
    toggleDone.setAttribute(
      "aria-label",
      this.hideDone ? "Show completed" : "Hide completed"
    );
    toggleDone.onclick = () => {
      this.hideDone = !this.hideDone;
      this.render();
    };

    if (!file) return;

    if (comments.length === 0) {
      contentEl.createDiv({
        cls: "note-comments-empty",
        text: "Select a passage and use the context menu to comment.",
      });
      return;
    }

    // Counters.
    const doneCount = comments.filter((c) => c.done).length;
    const pendingCount = comments.length - doneCount;
    contentEl.createDiv({
      cls: "note-comments-counts",
      text: `${pendingCount} pending · ${doneCount} completed`,
    });

    // Computes each comment's current position (for sorting and detecting orphans).
    const text = this.plugin.activeText;
    const enriched = comments
      .filter((c) => !(this.hideDone && c.done))
      .map((c) => ({
        comment: c,
        pos: text ? findAnchor(text, c)?.from ?? Number.MAX_SAFE_INTEGER : 0,
      }));

    enriched.sort((a, b) => {
      switch (this.sort) {
        case "position-asc":
          return a.pos - b.pos;
        case "position-desc":
          return b.pos - a.pos;
        case "created-asc":
          return a.comment.created - b.comment.created;
        case "created-desc":
          return b.comment.created - a.comment.created;
      }
    });

    const list = contentEl.createDiv({ cls: "note-comments-list" });
    for (const { comment, pos } of enriched) {
      this.renderCard(list, comment, pos === Number.MAX_SAFE_INTEGER);
    }
  }

  /** Scrolls to a comment's card and briefly highlights it. */
  focusComment(id: string): void {
    const card = this.contentEl.querySelector<HTMLElement>(
      `.text-comment-card[data-comment-id="${id}"]`
    );
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.addClass("is-flash");
    window.setTimeout(() => card.removeClass("is-flash"), 1200);
  }

  private renderCard(
    parent: HTMLElement,
    comment: TextComment,
    orphan: boolean
  ): void {
    const card = parent.createDiv({ cls: "text-comment-card" });
    card.setAttribute("data-comment-id", comment.id);
    if (orphan) card.addClass("is-orphan");
    if (comment.done) card.addClass("is-done");

    const quote = card.createDiv({ cls: "text-comment-quote" });
    quote.setText(comment.quote);
    if (orphan) quote.setAttribute("aria-label", "Passage not found in the document");

    card.createDiv({ cls: "text-comment-body", text: comment.body });

    const meta = this.cardMeta(comment);
    if (meta) card.createDiv({ cls: "text-comment-meta", text: meta });

    const actions = card.createDiv({ cls: "text-comment-actions" });

    const doneBtn = actions.createEl("button", { cls: "clickable-icon" });
    setIcon(doneBtn, comment.done ? "check-circle-2" : "circle");
    doneBtn.setAttribute(
      "aria-label",
      comment.done ? "Mark as pending" : "Mark as completed"
    );
    doneBtn.onclick = (e) => {
      e.stopPropagation();
      void this.plugin.toggleDone(comment);
    };

    const editBtn = actions.createEl("button", { cls: "clickable-icon" });
    setIcon(editBtn, "pencil");
    editBtn.setAttribute("aria-label", "Edit");
    editBtn.onclick = (e) => {
      e.stopPropagation();
      void this.plugin.editComment(comment);
    };

    const delBtn = actions.createEl("button", { cls: "clickable-icon" });
    setIcon(delBtn, "trash-2");
    delBtn.setAttribute("aria-label", "Delete");
    delBtn.onclick = (e) => {
      e.stopPropagation();
      void this.plugin.deleteComment(comment);
    };

    // Clicking a card jumps to the passage in the editor.
    card.onclick = () => this.plugin.scrollToComment(comment);
  }

  /** Metadata line (dates) from the audit history. */
  private cardMeta(comment: TextComment): string {
    const hist = comment.history ?? [];
    const parts: string[] = [];
    const created = hist.find((e) => e.action === "created");
    if (created) parts.push(`created ${formatTimestamp(created.at)}`);
    if (comment.done) {
      const done = [...hist].reverse().find((e) => e.action === "done");
      if (done) parts.push(`completed ${formatTimestamp(done.at)}`);
    }
    return parts.join(" · ");
  }
}
