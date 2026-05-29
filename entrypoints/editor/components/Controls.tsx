export interface Theme {
  mode: 'dark' | 'light';
  background: string;
  padding: number;
  width: number;
  rounded: boolean;
  showFrame: boolean;
}

const BACKGROUNDS = [
  { label: 'Blurple → Pink', value: 'linear-gradient(135deg, #5865f2, #eb459e)' },
  { label: 'Green → Blurple', value: 'linear-gradient(135deg, #57f287, #5865f2)' },
  { label: 'Sunset', value: 'linear-gradient(135deg, #faa61a, #f04747)' },
  { label: 'Aqua', value: 'linear-gradient(135deg, #00c2ff, #5865f2)' },
  { label: 'Midnight', value: '#1e1f22' },
  { label: 'Paper', value: '#e3e5e8' },
];

interface ControlsProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
  onExport: () => void;
  exporting: boolean;
  count: number;
}

export function Controls({ theme, onChange, onExport, exporting, count }: ControlsProps) {
  const set = (patch: Partial<Theme>) => onChange({ ...theme, ...patch });

  return (
    <aside className="controls">
      <div>
        <h1 className="brand">Discord Fancy Capture</h1>
        <p className="count">{count}개 메시지</p>
      </div>

      <section className="control-group">
        <span className="control-label">테마</span>
        <div className="seg">
          <button className={theme.mode === 'dark' ? 'on' : ''} onClick={() => set({ mode: 'dark' })}>
            다크
          </button>
          <button
            className={theme.mode === 'light' ? 'on' : ''}
            onClick={() => set({ mode: 'light' })}
          >
            라이트
          </button>
        </div>
      </section>

      <section className="control-group">
        <span className="control-label">배경</span>
        <div className="bg-grid">
          {BACKGROUNDS.map((bg) => (
            <button
              key={bg.value}
              title={bg.label}
              className={`bg-swatch ${theme.background === bg.value ? 'on' : ''}`}
              style={{ background: bg.value }}
              onClick={() => set({ background: bg.value })}
            />
          ))}
        </div>
      </section>

      <section className="control-group">
        <span className="control-label">여백 · {theme.padding}px</span>
        <input
          type="range"
          min={0}
          max={140}
          value={theme.padding}
          onChange={(e) => set({ padding: Number(e.target.value) })}
        />
      </section>

      <section className="control-group">
        <span className="control-label">너비 · {theme.width}px</span>
        <input
          type="range"
          min={380}
          max={920}
          step={10}
          value={theme.width}
          onChange={(e) => set({ width: Number(e.target.value) })}
        />
      </section>

      <section className="control-group toggles">
        <label>
          <input
            type="checkbox"
            checked={theme.rounded}
            onChange={(e) => set({ rounded: e.target.checked })}
          />
          둥근 모서리
        </label>
        <label>
          <input
            type="checkbox"
            checked={theme.showFrame}
            onChange={(e) => set({ showFrame: e.target.checked })}
          />
          배경 프레임
        </label>
      </section>

      <button className="export" onClick={onExport} disabled={exporting}>
        {exporting ? '내보내는 중…' : 'PNG로 저장'}
      </button>
    </aside>
  );
}
