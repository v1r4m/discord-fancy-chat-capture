import type { Capture, RuntimeMessage } from '@/utils/types';
import { STORAGE_KEY } from '@/utils/types';

export default defineBackground(() => {
  // Toolbar button toggles capture mode in the active Discord tab.
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id == null) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_CAPTURE' } satisfies RuntimeMessage);
    } catch {
      console.warn('[DFCC] No Discord content script in this tab — open discord.com and reload it.');
    }
  });

  // A finished capture arrives from the content script.
  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.type === 'CAPTURE_RESULT') void openEditor(message.capture);
  });
});

async function openEditor(capture: Capture): Promise<void> {
  const inlined = await inlineImages(capture);
  await browser.storage.local.set({ [STORAGE_KEY]: inlined });
  await browser.tabs.create({ url: browser.runtime.getURL('/editor.html') });
}

/**
 * Fetch every remote image referenced by the capture and replace its URL with a
 * data URL. Done here (not in the editor) because the background worker holds
 * the host permissions — so the editor stays free of cross-origin requests and
 * `html-to-image` can export a clean, untainted canvas.
 */
async function inlineImages(capture: Capture): Promise<Capture> {
  const urls = new Set<string>();
  for (const m of capture.messages) {
    if (m.author.avatarUrl) urls.add(m.author.avatarUrl);
    for (const r of m.reactions) if (r.emojiUrl) urls.add(r.emojiUrl);
    for (const a of m.attachments) urls.add(a.url);
    for (const url of extractImgSrcs(m.contentHtml)) urls.add(url);
  }

  const map = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const blob = await (await fetch(url)).blob();
        map.set(url, await blobToDataUrl(blob));
      } catch {
        // Leave the original URL in place — best effort.
      }
    }),
  );

  const sub = (url: string) => map.get(url) ?? url;
  const subHtml = (html: string) => {
    let out = html;
    for (const [original, dataUrl] of map) {
      if (out.includes(original)) out = out.replaceAll(original, dataUrl);
    }
    return out;
  };

  return {
    ...capture,
    messages: capture.messages.map((m) => ({
      ...m,
      author: { ...m.author, avatarUrl: sub(m.author.avatarUrl) },
      reactions: m.reactions.map((r) => ({
        ...r,
        emojiUrl: r.emojiUrl ? sub(r.emojiUrl) : null,
      })),
      attachments: m.attachments.map((a) => ({ ...a, url: sub(a.url) })),
      contentHtml: subHtml(m.contentHtml),
    })),
  };
}

/** Pull the `src` of every `<img>` out of sanitized content HTML. */
function extractImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img\s+src="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) out.push(match[1]);
  return out;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
