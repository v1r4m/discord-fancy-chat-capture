/**
 * Reads structured message data out of the Discord DOM.
 *
 * Discord's CSS class names are hashed (`message_a1b2c3`), so selectors lean on
 * stable bits: element ids (`chat-messages-…`, `message-content-…`), the
 * `<time datetime>` attribute, and `[class*="…"]` substring matches.
 */

import { sanitizeContent } from './sanitize-content';
import type {
  CapturedAttachment,
  CapturedAuthor,
  CapturedMessage,
  CapturedReaction,
  CapturedReply,
} from './types';

const MSG_SELECTOR = 'li[id^="chat-messages-"]';

/** Extract the trailing message id from a `chat-messages-<channel>-<id>` element. */
export function messageIdOf(li: HTMLElement): string {
  return li.id.slice(li.id.lastIndexOf('-') + 1);
}

/**
 * Scrape every message currently mounted in the Discord message list, in
 * document order. Grouped (consecutive same-author) messages don't repeat the
 * avatar/header in the DOM, so the author is carried forward.
 */
export function scrapeAllMessages(): CapturedMessage[] {
  const out: CapturedMessage[] = [];
  let carried: CapturedAuthor | null = null;

  for (const li of document.querySelectorAll<HTMLElement>(MSG_SELECTOR)) {
    const header = li.querySelector<HTMLElement>('[class*="header_"] [class*="username"]');
    const groupStart = header != null;

    if (groupStart) {
      carried = {
        name: header.textContent?.trim() || 'Unknown',
        avatarUrl: ownAvatar(li) ?? '',
        roleColor: header.style.color || null,
        bot: li.querySelector('[class*="botTag"]') != null,
      };
    }
    const author: CapturedAuthor =
      carried ?? { name: 'Unknown', avatarUrl: '', roleColor: null, bot: false };

    const contentEl = li.querySelector<HTMLElement>('[id^="message-content-"]');
    const time = li.querySelector('time');

    out.push({
      id: messageIdOf(li),
      author,
      timestamp: time?.getAttribute('datetime') ?? '',
      timestampLabel: time?.textContent?.trim() ?? '',
      contentHtml: contentEl ? sanitizeContent(contentEl) : '',
      edited: li.querySelector('[class*="edited"]') != null,
      reply: scrapeReply(li),
      reactions: scrapeReactions(li),
      attachments: scrapeAttachments(li),
      groupStart,
    });
  }
  return out;
}

/** The message's own avatar — skipping the tiny avatar in a reply preview. */
function ownAvatar(li: HTMLElement): string | null {
  for (const img of li.querySelectorAll<HTMLImageElement>('img[class*="avatar"]')) {
    if (!img.closest('[class*="repliedMessage"]')) return img.src;
  }
  return null;
}

function scrapeReply(li: HTMLElement): CapturedReply | null {
  const el = li.querySelector<HTMLElement>('[class*="repliedMessage"]');
  if (!el) return null;
  const author = el.querySelector<HTMLElement>('[class*="username"]');
  const text = el.querySelector<HTMLElement>(
    '[class*="repliedTextContent"], [class*="repliedTextPreview"]',
  );
  return {
    authorName: author?.textContent?.trim() ?? '',
    content: (text ?? el).textContent?.trim() ?? '',
  };
}

function scrapeReactions(li: HTMLElement): CapturedReaction[] {
  const out: CapturedReaction[] = [];
  for (const r of li.querySelectorAll<HTMLElement>('[class*="reaction_"]')) {
    const img = r.querySelector<HTMLImageElement>('img');
    const count = r.querySelector<HTMLElement>('[class*="reactionCount"]');
    out.push({
      emoji: img?.alt ?? '',
      emojiUrl: img?.src ?? null,
      count: Number.parseInt(count?.textContent ?? '1', 10) || 1,
    });
  }
  return out;
}

function scrapeAttachments(li: HTMLElement): CapturedAttachment[] {
  const out: CapturedAttachment[] = [];
  for (const img of li.querySelectorAll<HTMLImageElement>('img')) {
    if (!/\/attachments\//.test(img.src)) continue;
    if (img.closest('[class*="repliedMessage"]') || img.closest('[class*="reaction_"]')) continue;
    out.push({
      url: img.src,
      width: img.naturalWidth || null,
      height: img.naturalHeight || null,
    });
  }
  return out;
}

/** Best-effort name of the current channel / DM. */
export function getSourceName(): string {
  const heading = document.querySelector<HTMLElement>(
    'section[aria-label] h1, [class*="title_"] h1, h1[class*="title"]',
  );
  if (heading?.textContent?.trim()) return heading.textContent.trim();
  return (
    document.title
      .replace(/^\(\d+\)\s*/, '')
      .replace(/\s*[|•]\s*Discord.*$/i, '')
      .trim() || 'Discord'
  );
}
