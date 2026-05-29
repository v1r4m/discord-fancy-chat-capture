/**
 * Shared data contract between the three moving parts:
 *   content script  → scrapes these structures from the Discord DOM
 *   background      → inlines remote images into them
 *   editor page     → renders them
 */

export interface CapturedAuthor {
  name: string;
  /** Avatar URL — a remote CDN URL when scraped, a data URL after inlining. */
  avatarUrl: string;
  /** Inline role color (hex/rgb) if Discord applied one, else null. */
  roleColor: string | null;
  bot: boolean;
}

export interface CapturedReaction {
  /** Unicode character or `:name:` for custom emoji. */
  emoji: string;
  emojiUrl: string | null;
  count: number;
}

export interface CapturedAttachment {
  url: string;
  width: number | null;
  height: number | null;
}

export interface CapturedReply {
  authorName: string;
  content: string;
}

export interface CapturedMessage {
  id: string;
  author: CapturedAuthor;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Human label Discord showed, e.g. "Today at 4:21 PM". */
  timestampLabel: string;
  /**
   * Sanitized HTML — built by `sanitizeContent` from Discord's already-rendered
   * DOM, with hashed classes stripped and a fixed `dfcc-*` class set applied.
   * Any `<img>` `src` here is a remote URL when leaving the scraper; the
   * background worker rewrites it to a data URL before the editor reads it.
   */
  contentHtml: string;
  edited: boolean;
  reply: CapturedReply | null;
  reactions: CapturedReaction[];
  attachments: CapturedAttachment[];
  /** First message of an author group — render the avatar + header. */
  groupStart: boolean;
}

export interface Capture {
  /** Channel / DM name, best-effort. */
  source: string;
  capturedAt: string;
  messages: CapturedMessage[];
}

/** Messages passed over `browser.runtime` between the extension parts. */
export type RuntimeMessage =
  | { type: 'TOGGLE_CAPTURE' }
  | { type: 'CAPTURE_RESULT'; capture: Capture };

/** `browser.storage.local` key the editor reads its capture from. */
export const STORAGE_KEY = 'pending-capture';
