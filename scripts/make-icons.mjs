// Genera apple-touch-icon.png y og-default.png con el mismo ícono de marca del sitio (Phosphor mountains-fill)
// sobre el verde de acento. Usa sharp, que Astro ya incluye. Uso: node scripts/make-icons.mjs
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const ACCENT = '#2f6b3f';
const glyph = readFileSync('node_modules/@phosphor-icons/core/assets/fill/mountains-fill.svg', 'utf8').replace(
  'fill="currentColor"',
  'fill="#ffffff"',
);

async function compose(width, height, glyphSize, out) {
  const icon = await sharp(Buffer.from(glyph), { density: 1200 }).resize(glyphSize, glyphSize).png().toBuffer();
  await sharp({ create: { width, height, channels: 3, background: ACCENT } })
    .composite([{ input: icon, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

await compose(180, 180, 112, 'public/apple-touch-icon.png');
await compose(1200, 630, 300, 'public/og-default.png');
