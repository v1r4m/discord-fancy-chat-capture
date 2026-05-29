import type { CapturedMessage } from '@/utils/types';

/** Renders a single captured message, Discord-style. */
export function MessageView({ message: m }: { message: CapturedMessage }) {
  return (
    <div className={`msg ${m.groupStart ? 'group-start' : 'grouped'}`}>
      {m.groupStart ? (
        <img className="avatar" src={m.author.avatarUrl} alt="" />
      ) : (
        <div className="avatar-spacer" />
      )}

      <div className="msg-body">
        {m.reply && (
          <div className="reply">
            <span className="reply-author">@{m.reply.authorName}</span>
            <span className="reply-text">{m.reply.content}</span>
          </div>
        )}

        {m.groupStart && (
          <div className="msg-header">
            <span
              className="author"
              style={m.author.roleColor ? { color: m.author.roleColor } : undefined}
            >
              {m.author.name}
            </span>
            {m.author.bot && <span className="bot-tag">BOT</span>}
            {m.timestampLabel && <span className="timestamp">{m.timestampLabel}</span>}
          </div>
        )}

        {(m.contentHtml.trim() || m.edited) && (
          <div
            className="content"
            // contentHtml is already sanitized by `utils/sanitize-content.ts`.
            dangerouslySetInnerHTML={{
              __html:
                m.contentHtml +
                (m.edited ? '<span class="edited"> (편집됨)</span>' : ''),
            }}
          />
        )}

        {m.attachments.length > 0 && (
          <div className="attachments">
            {m.attachments.map((a, i) => (
              <img key={i} className="attachment" src={a.url} alt="" />
            ))}
          </div>
        )}

        {m.reactions.length > 0 && (
          <div className="reactions">
            {m.reactions.map((r, i) => (
              <span key={i} className="reaction">
                {r.emojiUrl ? <img src={r.emojiUrl} alt={r.emoji} /> : <span>{r.emoji}</span>}
                <span className="reaction-count">{r.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
