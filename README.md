# Verdelote

Catálogo de lotes con recorrido virtual en video. Prototipo publicado en GitHub Pages.

- Plan del MVP: `../PLAN.md` (fuera del repo)
- Sitio: https://cristiancpl.github.io/verdelote

## Diseño cinemático

Tema oscuro único (tokens en `src/styles/global.css`). La impresión a PDF sigue saliendo en claro.

Campos opcionales de `src/content/lotes/*.json` que activan las partes ricas de la ficha:

- `vuelo`: video del planeta al lote (hero del inicio y botón "Ver el vuelo"). `poster` es el primer cuadro, `final` el último y `etapas` arman la línea de tiempo. Sin `vuelo`, el hero usa el `teaser` o el primer clip.
- `historia`: capítulos del recorrido por scroll (`etiqueta`, `titulo`, `texto`, `media` y `video` opcional). En celular se muestran como tarjetas apiladas.
- `frase`: frase grande que abre la ficha (`principal` y `atenuada`).
- `foto_mosaico`: índice de la galería que se usa como foto del mosaico.

Decisión del inicio: el lote destacado no se repite en la grilla. Su tarjeta existe oculta y solo aparece cuando hay filtros activos y coincide, para que "Solo con recorrido" o un municipio lo encuentren.
