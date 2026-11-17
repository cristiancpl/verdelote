# Verdelote · Del espacio al lote

Demostración para AM Grupo Inmobiliario: un globo terráqueo en vivo baja hasta el lote, entra a la toma de dron sin corte y termina en la vista desde arriba con el lindero y sus medidas. Pensada primero para celular.

## Cómo funciona

- `src/pages/index.astro`: página única, textos y estilos (móvil primero).
- `src/scripts/recorrido.ts`: globo (MapLibre), descenso, entrada al video pegado al terreno y vista del lindero.
- `src/data/destinos.ts`: lotes, trayectoria de la cámara del dron, lindero y ficha.
- `public/lotes/demo/`: toma de dron en 1080p y 720p (esta última para ahorro de datos).

El lote de demostración es una pradera real en Loon (Países Bajos). Su lindero es la parcela catastral Assen AA 152 y la foto aérea es de PDOK. Video: Matthias Groeneveld, Pixabay.

## Desarrollo

```powershell
npm install
npm run dev
```

## Publicación

- Cloudflare Pages (proyecto `amgrupoinmobiliario`): `npm run deploy:cf`. La primera vez, `npx wrangler login --device`.
- GitHub Pages: el flujo `.github/workflows/deploy.yml` se ejecuta al subir a `main`.

El material anterior del proyecto (otros lotes, clips generados con IA, versión de octubre) está en `D:\TI\Codeeal_estaterchives` y en el historial de Git.
