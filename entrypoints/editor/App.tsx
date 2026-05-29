import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import type { Capture } from '@/utils/types';
import { STORAGE_KEY } from '@/utils/types';
import { Controls, type Theme } from './components/Controls';
import { MessageView } from './components/MessageView';

const DEFAULT_THEME: Theme = {
  mode: 'dark',
  background: 'linear-gradient(135deg, #5865f2, #eb459e)',
  padding: 56,
  width: 600,
  rounded: true,
  showFrame: true,
};

function themeFromUrl(): Partial<Theme> {
  const p = new URLSearchParams(location.search);
  const out: Partial<Theme> = {};
  const mode = p.get('mode');
  if (mode === 'light' || mode === 'dark') out.mode = mode;
  const bg = p.get('bg');
  if (bg) out.background = bg;
  return out;
}

export function App() {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [theme, setTheme] = useState<Theme>({ ...DEFAULT_THEME, ...themeFromUrl() });
  const [exporting, setExporting] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // `?demo=1` loads a built-in sample capture — useful for previewing the
    // editor outside an extension context (e.g. a headless screenshot).
    if (new URLSearchParams(location.search).has('demo')) {
      void import('./demo-capture').then((m) => setCapture(m.DEMO_CAPTURE));
      return;
    }
    try {
      browser.storage.local
        .get(STORAGE_KEY)
        .then((stored) => setCapture((stored[STORAGE_KEY] as Capture | undefined) ?? null))
        .catch(() => {
          /* not in an extension context — show empty state */
        });
    } catch {
      /* `browser` not present — show empty state */
    }
  }, []);

  async function exportPng() {
    if (!frameRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(frameRef.current, { pixelRatio: 2, cacheBust: true });
      const link = document.createElement('a');
      link.download = `discord-capture-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('[DFCC] export failed', err);
    } finally {
      setExporting(false);
    }
  }

  if (!capture) {
    return (
      <div className="app">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="app">
      <Controls
        theme={theme}
        onChange={setTheme}
        onExport={exportPng}
        exporting={exporting}
        count={capture.messages.length}
      />
      <div className="stage">
        <div
          ref={frameRef}
          className="frame"
          style={{
            background: theme.showFrame ? theme.background : 'transparent',
            padding: theme.showFrame ? theme.padding : 0,
          }}
        >
          <div
            className={`surface ${theme.mode}`}
            style={{ width: theme.width, borderRadius: theme.rounded ? 14 : 0 }}
          >
            {capture.messages.map((message, idx) => (
              <MessageView key={`${message.id}-${idx}`} message={message} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h1>아직 캡쳐가 없어요</h1>
      <ol>
        <li>
          브라우저에서 <code>discord.com</code>을 열고 캡쳐할 대화로 이동합니다.
        </li>
        <li>툴바의 확장 프로그램 아이콘을 클릭해 캡쳐 모드를 켭니다.</li>
        <li>시작 메시지와 끝 메시지를 차례로 클릭합니다.</li>
        <li>이 에디터가 자동으로 열리며 결과가 나타납니다.</li>
      </ol>
    </div>
  );
}
