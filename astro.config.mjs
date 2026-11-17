// @ts-check
import { defineConfig } from 'astro/config';

// Cloudflare Pages (CF_PAGES=1) sirve el sitio en la raíz de su dominio; GitHub Pages, bajo /verdelote.
// SITE_URL y BASE_PATH permiten fijar otro dominio o ruta sin tocar el código.
const enCloudflare = process.env.CF_PAGES === '1';
const BASE = process.env.BASE_PATH ?? (enCloudflare ? '/' : '/verdelote');
const SITE = process.env.SITE_URL ?? (enCloudflare ? process.env.CF_PAGES_URL : undefined) ?? 'https://cristiancpl.github.io';

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  server: { port: 4321 },
  devToolbar: { enabled: false },
});
