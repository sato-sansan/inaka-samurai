import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
export default defineConfig({
  site: 'https://inaka-samurai.jp', // 将来の独自ドメイン
  integrations: [
    tailwind(),
    react(),
    mdx(),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
