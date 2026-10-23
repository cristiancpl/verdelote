// Genera favicon.png, apple-touch-icon.png y og-default.png con el logo de AM Grupo Inmobiliario
// (src/assets/marca, sale de scripts/marca.py) sobre el fondo oscuro del sitio. Usa sharp, que Astro ya incluye.
// Uso: node scripts/make-icons.mjs
import sharp from 'sharp';

const FONDO = '#0b0c0d';
const MARCA = 'src/assets/marca/am-marca-claro.png';
const LOGO = 'src/assets/marca/am-logo-claro.png';

async function compose(width, height, src, ancho, out) {
  const icon = await sharp(src).resize({ width: ancho }).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: FONDO } })
    .composite([{ input: icon, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}

await compose(64, 64, MARCA, 54, 'public/favicon.png');
await compose(180, 180, MARCA, 140, 'public/apple-touch-icon.png');
await compose(1200, 630, LOGO, 620, 'public/og-default.png');
