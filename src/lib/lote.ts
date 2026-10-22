import type { CollectionEntry } from 'astro:content';

type Datos = CollectionEntry<'lotes'>['data'];

/** Un lote "con recorrido" si tiene vuelo, recorrido completo o algún video en sus capítulos */
export const tieneRecorrido = (d: Datos) =>
  Boolean(d.vuelo || d.video_completo) || d.recorrido.some((c) => c.video) || d.historia.some((h) => h.video);

/** Primer video con su imagen de portada: historia primero, luego recorrido */
export const primerClip = (d: Datos) => {
  const h = d.historia.find((x) => x.video);
  if (h) return { src: h.video!, poster: h.media };
  const r = d.recorrido.find((x) => x.video);
  return r ? { src: r.video!, poster: r.poster } : undefined;
};
