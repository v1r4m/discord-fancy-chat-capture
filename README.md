# Discord Fancy Chat Capture

Capture Discord chats as long, beautiful, shareable images — like
[carbon.now.sh](https://carbon.now.sh), but for Discord conversations.

## Why a browser extension (and not a web app)

Reading Discord message history needs access to the messages:

- **OAuth2** can't do it — there is no general "read messages" scope for
  third-party apps.
- A **user account token** would work but is a Terms-of-Service violation
  (self-botting) and risks an account ban — so it's off the table.
- A **bot token** is legitimate but needs Manage Server permission and can't
  read DMs.

The extension instead reads the messages **already rendered on the page you're
looking at**. No token, no login, nothing leaves your machine — it only
captures what you can already see.

## How it works

```
content script  →  background worker  →  editor page
scrape the DOM     inline images as     render + theme +
(start → end)      data URLs            export to PNG
```

1. **`entrypoints/discord.content.ts`** — runs on `discord.com`. Click a start
   message and an end message; everything between is scraped
   (`utils/dom-scraper.ts`).
2. **`entrypoints/background.ts`** — fetches avatars / emoji / attachments and
   inlines them as data URLs so the editor stays cross-origin-free, then opens
   the editor.
3. **`entrypoints/editor/`** — a React app (an extension page) that re-renders
   the messages, applies a theme/background, and exports a PNG via
   `html-to-image`.

`utils/types.ts` is the shared data contract between the three.

## Develop

```sh
npm install        # also runs `wxt prepare`
npm run dev        # launches Chrome with the extension loaded
npm run build      # production build → .output/
npm run compile    # type-check only
```

Click the extension's toolbar icon on a `discord.com` tab to start a capture.
(Reload the Discord tab once after first installing so the content script
attaches.)

## MVP scope / known limitations

- Captures only messages **currently loaded** in the page. For a long range,
  scroll through it once so it mounts, then pick start/end. (Auto-scroll
  collection is a planned follow-up.)
- Rich content is captured by **re-using Discord's already-rendered DOM**
  (bold, italic, code, code blocks, blockquotes, lists, headings, links,
  mentions, spoilers, custom + unicode emoji) — sanitized by
  `utils/sanitize-content.ts` into a tag whitelist with `dfcc-*` classes.
- Discord's CSS class names are hashed; selectors are resilient but may need
  updates if Discord changes its DOM.
- No toolbar icon art yet — drop PNGs into `public/icon/` to add one.
