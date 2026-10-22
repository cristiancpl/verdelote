const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const num = new Intl.NumberFormat('es-CO');

export const formatPrecio = (valor: number) => cop.format(valor);

export const formatArea = (m2: number) => `${num.format(m2)} m²`;

/** Une una ruta con el base path del sitio (GitHub Pages sirve bajo /verdelote) */
export const url = (path = '') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
