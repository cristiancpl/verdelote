# AM Grupo Inmobiliario

Catálogo de lotes con recorrido virtual en video y globo 3D. Prototipo publicado en GitHub Pages.
El repositorio conserva el nombre `verdelote` (marca anterior); el sitio pasará a un dominio propio con Cloudflare.

- Plan del MVP: `../PLAN.md` y plan del globo: `../PLAN_GLOBO.md` (fuera del repo)
- Sitio: https://cristiancpl.github.io/verdelote

## Marca

Logo del cliente en `../prep/marca/am-logo-original.jpg`. `python scripts/marca.py` lo separa del fondo y genera
las versiones de `src/assets/marca/` (clara para fondo oscuro, oscura con sus colores, completo y monograma).
`node scripts/make-icons.mjs` arma favicon, ícono de iPhone e imagen para compartir. Acento dorado `#b78f54`.

## Diseño cinemático

Tema oscuro único (tokens en `src/styles/global.css`). La impresión a PDF sigue saliendo en claro.

Campos opcionales de `src/content/lotes/*.json` que activan las partes ricas de la ficha:

- `vuelo`: video del planeta al lote (hero del inicio y botón "Ver el vuelo"). `poster` es el primer cuadro, `final` el último y `etapas` arman la línea de tiempo. Sin `vuelo`, el hero usa el `teaser` o el primer clip.
- `historia`: capítulos del recorrido por scroll (`etiqueta`, `titulo`, `texto`, `media` y `video` opcional). En celular se muestran como tarjetas apiladas.
- `frase`: frase grande que abre la ficha (`principal` y `atenuada`).
- `foto_mosaico`: índice de la galería que se usa como foto del mosaico.
- `mapa`: posición del marcador en el globo si difiere de `coordenadas`, altura del terreno y cámara de llegada.

Decisión del inicio: el lote destacado no se repite en la grilla. Su tarjeta existe oculta y solo aparece cuando hay filtros activos y coincide, para que "Solo con recorrido" o un municipio lo encuentren. Con un solo lote la grilla se oculta.

## Globo (`/globo/`)

Mapas 3D de Google (`gmp-map-3d`). Clave en `PUBLIC_GOOGLE_MAPS_KEY` (`.env` local; variable del repositorio para Pages).
En desarrollo la ficha trae "Dibujar lindero", que guarda `public/capas/lindero-<lote>.geojson`.
`python scripts/capas.py` genera los contornos de país, región y municipios en `public/capas/`.
