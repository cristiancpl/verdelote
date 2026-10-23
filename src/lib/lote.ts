import type { CollectionEntry } from 'astro:content';
import { formatArea, formatPrecio, formatPrecioCorto, formatPrecioM2 } from './format';

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

// Área y precio de un lote o de una parcelación con rango (area_max_m2, precio_max_cop)
export const textoArea = (d: Datos) =>
  d.area_max_m2 ? `${formatArea(d.area_m2).replace(' m²', '')} a ${formatArea(d.area_max_m2)}` : formatArea(d.area_m2);
export const textoPrecio = (d: Datos) =>
  !d.precio_cop ? 'Precio a consultar' : d.precio_max_cop ? `Desde ${formatPrecio(d.precio_cop)}` : formatPrecio(d.precio_cop);
export const textoPrecioCorto = (d: Datos) =>
  !d.precio_cop ? 'A consultar' : d.precio_max_cop ? `Desde ${formatPrecioCorto(d.precio_cop)}` : formatPrecioCorto(d.precio_cop);
/** Línea bajo el precio: valor por m² de un lote, el rango de una parcelación, o cómo pedirlo */
export const textoPrecioDetalle = (d: Datos) =>
  !d.precio_cop
    ? 'Pregunta por WhatsApp'
    : d.precio_max_cop
    ? `${formatPrecioCorto(d.precio_cop)} a ${formatPrecioCorto(d.precio_max_cop)}`
    : formatPrecioM2(d.precio_cop, d.area_m2);
