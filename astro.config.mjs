// @ts-check
import { writeFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';

const BASE = '/verdelote';

/**
 * Solo en `astro dev`: recibe el lindero dibujado en /globo/ y lo guarda en public/capas/lindero-<slug>.geojson
 * @returns {import('vite').Plugin}
 */
const guardarLindero = () => ({
  name: 'verdelote-guardar-lindero',
  apply: 'serve',
  configureServer(server) {
    // Astro quita el base antes de los middlewares: se acepta con o sin /verdelote
    server.middlewares.use((req, res, next) => {
      if (!/^(\/verdelote)?\/__lindero(\?|$)/.test(req.url ?? '')) return next();
      if (req.method !== 'POST') {
        res.statusCode = 405;
        return res.end();
      }
      let cuerpo = '';
      req.on('data', (parte) => (cuerpo += parte));
      req.on('end', async () => {
        try {
          const geo = JSON.parse(cuerpo);
          const feature = geo.features?.[0];
          const slug = feature?.properties?.slug;
          const anillo = feature?.geometry?.coordinates?.[0];
          if (!/^[a-z0-9-]+$/.test(slug ?? '') || !Array.isArray(anillo) || anillo.length < 4) throw new Error('Lindero inválido');
          const ruta = new URL(`./public/capas/lindero-${slug}.geojson`, import.meta.url);
          await writeFile(ruta, JSON.stringify(geo, null, 2) + '\n', 'utf-8');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e));
        }
      });
    });
  },
});

// https://astro.build/config
export default defineConfig({
  site: 'https://cristiancpl.github.io',
  base: BASE,
  vite: { plugins: [guardarLindero()] },
});
