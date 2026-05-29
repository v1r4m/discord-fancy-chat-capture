import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Discord Fancy Chat Capture',
    description: 'Capture Discord chats as long, beautiful, shareable images.',
    permissions: ['storage'],
    // The background worker fetches avatars / emoji / attachments and inlines
    // them as data URLs, so the editor never makes a cross-origin request.
    host_permissions: [
      'https://*.discordapp.com/*',
      'https://*.discordapp.net/*',
      'https://discord.com/*',
    ],
    action: {
      default_title: 'Capture Discord chat',
    },
  },
});
