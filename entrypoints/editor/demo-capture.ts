/**
 * A self-contained sample capture used by `?demo=1` for visual verification.
 * Every image is a `data:image/svg+xml,…` URL so the editor renders without
 * any network access — even outside the extension context.
 */

import type { Capture } from '@/utils/types';

function dataSvg(svg: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function avatar(letter: string, bg: string): string {
  return dataSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="40" fill="${bg}"/><text x="40" y="52" font-family="system-ui,sans-serif" font-size="36" font-weight="700" fill="white" text-anchor="middle">${letter}</text></svg>`,
  );
}

function emojiImg(emoji: string, bg: string): string {
  return dataSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><circle cx="22" cy="22" r="20" fill="${bg}"/><text x="22" y="31" font-size="22" text-anchor="middle">${emoji}</text></svg>`,
  );
}

function attachmentImg(): string {
  return dataSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5865f2"/><stop offset="1" stop-color="#eb459e"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="200" font-family="system-ui,sans-serif" font-size="44" font-weight="700" fill="white" text-anchor="middle" letter-spacing="2">demo attachment</text></svg>`,
  );
}

const ALICE = { name: 'Alice', avatarUrl: avatar('A', '#5865f2'), roleColor: '#f47b67', bot: false };
const BOB = { name: 'Bob', avatarUrl: avatar('B', '#43b581'), roleColor: null, bot: false };
const CHARLIE = { name: 'Charlie', avatarUrl: avatar('C', '#faa61a'), roleColor: '#5865f2', bot: true };

const FIRE = emojiImg('🔥', '#f04747');
const TADA = emojiImg('🎉', '#faa61a');
const HEART = emojiImg('❤', '#ed4245');

const NOW = new Date().toISOString();

export const DEMO_CAPTURE: Capture = {
  source: '#fancy-capture-demo',
  capturedAt: NOW,
  messages: [
    {
      id: 'm1',
      author: ALICE,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:21',
      contentHtml: `안녕! 디스코드 채팅을 예쁘게 캡쳐하는 도구를 만들어봤어요 <img src="${TADA}" alt=":tada:" class="dfcc-emoji">`,
      edited: false,
      reply: null,
      reactions: [
        { emoji: '🔥', emojiUrl: FIRE, count: 3 },
        { emoji: '🎉', emojiUrl: TADA, count: 5 },
      ],
      attachments: [],
      groupStart: true,
    },
    {
      id: 'm2',
      author: BOB,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:22',
      contentHtml:
        '와 이거 진짜 멋진데? <strong>마크다운</strong>도 되고, <em>이탤릭</em>이나 <code class="dfcc-code">inline code</code>까지 ㅋㅋ <a href="https://carbon.now.sh" class="dfcc-link">carbon</a> 처럼!',
      edited: false,
      reply: { authorName: 'Alice', content: '안녕! 디스코드 채팅을 예쁘게 캡쳐하는 도구를…' },
      reactions: [],
      attachments: [],
      groupStart: true,
    },
    {
      id: 'm3',
      author: BOB,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:22',
      contentHtml: '코드블록은 어떻게 보이려나?',
      edited: false,
      reply: null,
      reactions: [],
      attachments: [],
      groupStart: false,
    },
    {
      id: 'm4',
      author: BOB,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:23',
      contentHtml:
        '<pre class="dfcc-codeblock"><code>const greet = (name) =&gt; {\n  return `Hello, ${name}!`;\n};\n\nconsole.log(greet(\'world\'));</code></pre>',
      edited: false,
      reply: null,
      reactions: [],
      attachments: [],
      groupStart: false,
    },
    {
      id: 'm5',
      author: ALICE,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:24',
      contentHtml: '스포일러도 <span class="dfcc-spoiler">비밀이야</span> 보여줄 수 있어요',
      edited: false,
      reply: null,
      reactions: [],
      attachments: [],
      groupStart: true,
    },
    {
      id: 'm6',
      author: ALICE,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:24',
      contentHtml:
        '<blockquote class="dfcc-quote">인용도 이렇게 됩니다.<br>여러 줄도 가능해요.</blockquote>',
      edited: false,
      reply: null,
      reactions: [],
      attachments: [],
      groupStart: false,
    },
    {
      id: 'm7',
      author: CHARLIE,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:30',
      contentHtml: `<span class="dfcc-mention">@Alice</span> 짱이다 진짜 <img src="${HEART}" alt="❤" class="dfcc-emoji">`,
      edited: false,
      reply: null,
      reactions: [],
      attachments: [],
      groupStart: true,
    },
    {
      id: 'm8',
      author: CHARLIE,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:31',
      contentHtml:
        '리스트도 보여줄게:<ul class="dfcc-list"><li>하나</li><li>둘</li><li>셋</li></ul>',
      edited: true,
      reply: null,
      reactions: [],
      attachments: [],
      groupStart: false,
    },
    {
      id: 'm9',
      author: ALICE,
      timestamp: NOW,
      timestampLabel: '오늘 오후 4:35',
      contentHtml: '이렇게 첨부 이미지도 같이 잡혀요:',
      edited: false,
      reply: null,
      reactions: [],
      attachments: [{ url: attachmentImg(), width: 640, height: 360 }],
      groupStart: true,
    },
  ],
};
