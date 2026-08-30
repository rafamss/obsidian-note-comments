export type SortKey =
  | "position-asc"
  | "position-desc"
  | "created-asc"
  | "created-desc";

/** Actions recorded in a comment's audit trail. */
export type HistoryAction = "created" | "edited" | "done" | "reopened";

export interface HistoryEvent {
  /** Event timestamp (epoch ms). */
  at: number;
  action: HistoryAction;
}

export interface TextComment {
  /** Stable comment identifier. */
  id: string;
  /** The exact passage that was commented (the "anchor"). */
  quote: string;
  /** Text immediately before the passage, used for disambiguation. */
  prefix: string;
  /** Text immediately after the passage, used for disambiguation. */
  suffix: string;
  /** The comment body written by the user. */
  body: string;
  /** Comment completed (resolved)? Changes the highlight color. */
  done?: boolean;
  /** Optional per-comment color (CSS). Takes precedence. */
  color?: string;
  /** Audit trail: every state change becomes an event. */
  history: HistoryEvent[];
  created: number;
  modified: number;
}

/** Ensures every comment has a history (backward compatibility). */
export function ensureHistory(c: TextComment): TextComment {
  if (!c.history || c.history.length === 0) {
    c.history = [{ at: c.created || c.modified || Date.now(), action: "created" }];
  }
  return c;
}

/** Formats a timestamp as `YYYY-MM-DD HH:mm` (local time). */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

export interface PluginSettings {
  /** Folder where comment notes are stored. */
  commentsFolder: string;
  /** How many context characters to keep before/after the passage. */
  contextLength: number;
  /** Default panel sorting. */
  defaultSort: SortKey;
  /** Highlight color for pending comments. Empty = theme default. */
  pendingColor: string;
  /** Highlight color for completed comments. */
  doneColor: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  commentsFolder: "Comments",
  contextLength: 32,
  defaultSort: "position-asc",
  pendingColor: "",
  doneColor: "#4caf50",
};

/**
 * Resolves the color and state of a comment's highlight.
 * A null `color` means "use the theme default".
 */
export function resolveHighlight(
  c: TextComment,
  s: PluginSettings
): { color: string | null; done: boolean } {
  const done = !!c.done;
  if (done) return { color: s.doneColor.trim() || null, done };
  return { color: c.color?.trim() || s.pendingColor.trim() || null, done };
}
