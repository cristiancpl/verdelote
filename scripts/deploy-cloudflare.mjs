// Compila el sitio para Cloudflare Pages (raíz del dominio) y lo publica en el proyecto amgrupoinmobiliario.
// Requiere `npx wrangler login --device` una vez (en Windows el puerto 8976 del login normal está reservado).
// La clave de Maps sale de .env (PUBLIC_GOOGLE_MAPS_KEY). Uso: npm run deploy:cf
import { execSync } from 'node:child_process';

const PROYECTO = 'amgrupoinmobiliario';
const env = { ...process.env, CF_PAGES: '1', SITE_URL: `https://${PROYECTO}.pages.dev` };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });

run('npx astro build');
run(`npx --yes wrangler@4 pages deploy dist --project-name ${PROYECTO} --branch globo --commit-dirty=true`);
