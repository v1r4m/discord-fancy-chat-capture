import { getSourceName, messageIdOf, scrapeAllMessages } from '@/utils/dom-scraper';
import type { Capture, RuntimeMessage } from '@/utils/types';

const MSG_SELECTOR = 'li[id^="chat-messages-"]';

export default defineContentScript({
  matches: ['https://discord.com/*', 'https://*.discord.com/*'],
  main() {
    injectStyles();
    const session = new CaptureSession();
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message.type === 'TOGGLE_CAPTURE') session.toggle();
    });
  },
});

/**
 * Drives the on-page capture flow: the user clicks a start message, then an end
 * message, and everything between them is scraped and sent to the background.
 */
class CaptureSession {
  private mode: 'idle' | 'start' | 'end' = 'idle';
  private startId: string | null = null;
  private banner: HTMLElement | null = null;
  private hovered: HTMLElement | null = null;

  toggle(): void {
    if (this.mode === 'idle') this.begin();
    else this.cancel();
  }

  private begin(): void {
    this.mode = 'start';
    this.startId = null;
    this.banner = document.body.appendChild(Object.assign(document.createElement('div'), {
      className: 'dfcc-banner',
    }));
    this.updateBanner();
    document.addEventListener('mousemove', this.onMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKey, true);
  }

  cancel(): void {
    this.mode = 'idle';
    this.startId = null;
    this.clearHover();
    document.querySelectorAll('.dfcc-start').forEach((el) => el.classList.remove('dfcc-start'));
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKey, true);
    this.banner?.remove();
    this.banner = null;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    }
  };

  private onMove = (e: MouseEvent): void => {
    const li = (e.target as HTMLElement | null)?.closest<HTMLElement>(MSG_SELECTOR) ?? null;
    if (li === this.hovered) return;
    this.clearHover();
    if (li) {
      li.classList.add('dfcc-hover');
      this.hovered = li;
    }
  };

  private clearHover(): void {
    this.hovered?.classList.remove('dfcc-hover');
    this.hovered = null;
  }

  private onClick = (e: MouseEvent): void => {
    const li = (e.target as HTMLElement | null)?.closest<HTMLElement>(MSG_SELECTOR);
    if (!li) return;
    // Swallow the click so Discord doesn't react to it.
    e.preventDefault();
    e.stopPropagation();

    if (this.mode === 'start') {
      this.startId = messageIdOf(li);
      li.classList.add('dfcc-start');
      this.mode = 'end';
      this.updateBanner();
    } else if (this.mode === 'end') {
      this.finish(messageIdOf(li));
    }
  };

  private finish(endId: string): void {
    const all = scrapeAllMessages();
    let i = all.findIndex((m) => m.id === this.startId);
    let j = all.findIndex((m) => m.id === endId);
    if (i === -1 || j === -1) {
      this.setBanner('⚠️ 메시지를 찾지 못했어요 — 구간이 화면 밖으로 벗어났을 수 있어요. 다시 클릭해 주세요.');
      return;
    }
    if (i > j) [i, j] = [j, i];

    const messages = all.slice(i, j + 1);
    // The first message of the selection always shows its header, even if it
    // was mid-group in the original conversation.
    messages[0] = { ...messages[0], groupStart: true };

    const capture: Capture = {
      source: getSourceName(),
      capturedAt: new Date().toISOString(),
      messages,
    };
    void browser.runtime.sendMessage({ type: 'CAPTURE_RESULT', capture } satisfies RuntimeMessage);

    this.mode = 'idle';
    this.setBanner(`✅ ${messages.length}개 메시지 캡쳐 완료 — 에디터를 여는 중…`);
    window.setTimeout(() => this.cancel(), 1600);
  }

  private updateBanner(): void {
    this.setBanner(
      this.mode === 'start'
        ? '1 / 2  ·  캡쳐를 시작할 메시지를 클릭하세요    (Esc: 취소)'
        : '2 / 2  ·  캡쳐를 끝낼 메시지를 클릭하세요    (Esc: 취소)',
    );
  }

  private setBanner(text: string): void {
    if (this.banner) this.banner.textContent = text;
  }
}

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    .dfcc-banner {
      position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; pointer-events: none;
      background: #5865f2; color: #fff;
      font: 600 14px/1.4 -apple-system, system-ui, sans-serif;
      padding: 11px 20px; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .45);
    }
    .dfcc-hover {
      outline: 2px solid #5865f2 !important; outline-offset: -2px;
      background: rgba(88, 101, 242, .10) !important; cursor: crosshair !important;
    }
    .dfcc-start {
      outline: 2px solid #3ba55d !important; outline-offset: -2px;
      background: rgba(59, 165, 93, .14) !important;
    }
  `;
  document.head.appendChild(style);
}
