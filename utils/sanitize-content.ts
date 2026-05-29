/**
 * Turn the already-rendered children of a Discord `message-content-…` element
 * into a sanitized HTML string we control the styling of.
 *
 * Discord has already parsed the markdown — bold is `<strong>`, code is
 * `<code>`, mentions are `<span class="mention_…">`, custom emoji are `<img>`,
 * and so on. We rebuild that tree using a tag whitelist with our own
 * `dfcc-*` classes, dropping Discord's hashed classes and anything we don't
 * recognize. The result is safe to feed to `dangerouslySetInnerHTML`.
 */

/** Sanitize the children of a Discord message-content element. */
export function sanitizeContent(root: Element): string {
  let out = '';
  for (const child of root.childNodes) out += serialize(child);
  return out;
}

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const children = () => {
    let s = '';
    for (const child of el.childNodes) s += serialize(child);
    return s;
  };

  switch (el.tagName.toLowerCase()) {
    case 'br':
      return '<br>';

    case 'strong':
    case 'b':
      return `<strong>${children()}</strong>`;

    case 'em':
    case 'i':
      return `<em>${children()}</em>`;

    case 's':
    case 'del':
    case 'strike':
      return `<s>${children()}</s>`;

    case 'u':
      return `<u>${children()}</u>`;

    case 'code':
      // The codeblock case (<pre><code>) is handled by <pre>; inline <code>
      // gets the inline-code class.
      return `<code class="dfcc-code">${children()}</code>`;

    case 'pre':
      return `<pre class="dfcc-codeblock">${children()}</pre>`;

    case 'blockquote':
      return `<blockquote class="dfcc-quote">${children()}</blockquote>`;

    case 'ol':
      return `<ol class="dfcc-list">${children()}</ol>`;
    case 'ul':
      return `<ul class="dfcc-list">${children()}</ul>`;
    case 'li':
      return `<li>${children()}</li>`;

    case 'h1':
      return `<div class="dfcc-h1">${children()}</div>`;
    case 'h2':
      return `<div class="dfcc-h2">${children()}</div>`;
    case 'h3':
      return `<div class="dfcc-h3">${children()}</div>`;

    case 'a': {
      const href = sanitizeUrl(el.getAttribute('href') ?? '');
      return `<a href="${escapeAttr(href)}" class="dfcc-link">${children()}</a>`;
    }

    case 'img': {
      const src = (el as HTMLImageElement).src;
      const alt = el.getAttribute('alt') ?? '';
      // URLs that would break the attribute or aren't safe → drop the image.
      if (!src || src.includes('"') || !/^https?:/i.test(src)) return '';
      return `<img src="${src}" alt="${escapeAttr(alt)}" class="dfcc-emoji">`;
    }

    case 'span': {
      const cls = el.getAttribute('class') ?? '';
      if (/mention/i.test(cls)) return `<span class="dfcc-mention">${children()}</span>`;
      if (/spoiler/i.test(cls)) return `<span class="dfcc-spoiler">${children()}</span>`;
      return children(); // unwrap unknown spans
    }

    case 'div':
    case 'p':
      // Discord wraps paragraphs/blocks in divs we don't need to preserve.
      return children();

    case 'script':
    case 'style':
    case 'iframe':
    case 'object':
    case 'embed':
      return '';

    default:
      // Strip the tag, keep the text inside.
      return children();
  }
}

const ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITY_MAP[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** Allow http(s) / mailto / discord deep links / anchors only — block javascript:, data:, etc. */
function sanitizeUrl(url: string): string {
  if (!url) return '#';
  if (/^(https?:|mailto:|discord:|#)/i.test(url)) return url;
  return '#';
}
