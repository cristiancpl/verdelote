const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const num = new Intl.NumberFormat('es-CO');

export const formatPrecio = (valor: number) => cop.format(valor);

export const formatArea = (m2: number) => `${num.format(m2)} m²`;

/** Une una ruta con el base path del sitio (/verdelote en GitHub Pages, / en Cloudflare) */
export const url = (path = '') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

/** Convierte una ruta ya resuelta con base (ej. /verdelote/lotes/x/) en URL absoluta del sitio */
export const absoluteUrl = (path: string) => new URL(path, import.meta.env.SITE ?? 'http://localhost').href;

/** Valor aproximado por m² sobre el área total, ej. "≈ $ 65.789 / m²" */
export const formatPrecioM2 = (precio: number, areaM2: number) =>
  `≈ ${cop.format(Math.round(precio / areaM2))} / m²`;

/** 573216953286 -> +57 321 695 3286 (formato colombiano); otros indicativos, solo con "+" */
export const formatTelefono = (digitos: string) =>
  /^57\d{10}$/.test(digitos)
    ? `+57 ${digitos.slice(2, 5)} ${digitos.slice(5, 8)} ${digitos.slice(8)}`
    : `+${digitos}`;

/** Precio corto en millones, ej. 250000000 -> "$250 M" */
export const formatPrecioCorto = (precio: number) => `$${num.format(Math.round(precio / 1_000_000))} M`;

/** "Lote Mirador del Norte" -> "Mirador del Norte" (nombre para titulares y tarjetas) */
export const nombreCorto = (nombre: string) => nombre.replace(/^Lote\s+/i, '');
