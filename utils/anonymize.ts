import type { Capture, CapturedMessage } from './types';
import { defaultAvatar } from './default-avatar';

/** Distinct author names in order of first appearance. */
export function distinctAuthors(messages: CapturedMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (!seen.has(m.author.name)) {
      seen.add(m.author.name);
      out.push(m.author.name);
    }
  }
  return out;
}

/**
 * Builds the censored display label for an author, stable per person so the
 * same masked name appears everywhere (headers and reply quotes alike).
 */
function censoredLabel(name: string, authors: string[]): string {
  const idx = authors.indexOf(name);
  return `익명${idx < 0 ? '' : idx + 1}`;
}

/**
 * Returns a copy of the capture with the named authors masked: their name
 * becomes `익명N`, their avatar becomes a default Discord avatar, and their
 * role color is dropped so identity can't leak through styling. The original
 * capture is left untouched — this is display-only.
 */
export function anonymizeCapture(capture: Capture, anonymized: Set<string>): Capture {
  if (anonymized.size === 0) return capture;
  const authors = distinctAuthors(capture.messages);

  const messages = capture.messages.map((m) => {
    const next: CapturedMessage = { ...m };

    if (anonymized.has(m.author.name)) {
      next.author = {
        ...m.author,
        name: censoredLabel(m.author.name, authors),
        avatarUrl: defaultAvatar(authors.indexOf(m.author.name)),
        roleColor: null,
      };
    }

    if (m.reply && anonymized.has(m.reply.authorName)) {
      next.reply = { ...m.reply, authorName: censoredLabel(m.reply.authorName, authors) };
    }

    return next;
  });

  return { ...capture, messages };
}
