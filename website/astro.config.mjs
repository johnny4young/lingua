import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://linguacode.dev',
  trailingSlash: 'never',
  prerenderConflictBehavior: 'error',
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/_') && !/\/thanks\/?$/.test(page),
    }),
    icon({
      include: {
        lucide: ['*'],
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: 'auto',
    assets: 'static',
  },
  experimental: {
    contentIntellisense: true,
  },
});
