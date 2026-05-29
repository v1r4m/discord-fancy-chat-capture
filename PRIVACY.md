# Privacy Policy — Fancy Chat Capture for Discord

_Last updated: 2026-05-29_

Fancy Chat Capture for Discord ("the extension") turns Discord chat messages
into styled images. This policy describes exactly what it does with your data.
The short version: **everything happens locally in your browser, and nothing is
ever sent to the developer or any third party.**

## What the extension accesses

- **Messages you select on discord.com.** When you start a capture and click a
  start and an end message, the extension reads the messages already rendered on
  that page (author, text, timestamps, reactions, attachments) in order to
  re-draw them.
- **Images referenced by those messages.** Avatars, emoji, and image
  attachments are downloaded from Discord's CDN and embedded into the capture as
  data, so the resulting image is self-contained.

It only ever reads content you can already see and explicitly select. It does
not read other tabs, your browsing history, or anything outside discord.com.

## Where your data goes

- Captures are held in your browser's local extension storage (`storage.local`)
  solely to hand the selected messages to the editor tab.
- All rendering and PNG export happen on your device.
- **No data is transmitted to the developer or any external server. There is no
  analytics, no tracking, and no third-party service.**
- Exported images are saved only where you choose to download them.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `storage` | Pass the selected capture from the page to the editor tab. |
| Access to `discord.com`, `*.discordapp.com`, `*.discordapp.net` | Read the messages you select, and download their avatars / emoji / attachments to embed in the image. |

## Data retention

The extension keeps only the most recent capture in local storage so the editor
can reopen it; it is overwritten by your next capture and removed when you
uninstall the extension. The developer never receives or stores it.

## Not affiliated with Discord

This is an independent, unofficial tool. It is not affiliated with, endorsed by,
or sponsored by Discord Inc.

## Contact

Questions or concerns: please open an issue at
<https://github.com/v1r4m/discord-fancy-chat-capture/issues>.
