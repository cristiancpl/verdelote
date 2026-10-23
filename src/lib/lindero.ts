// Dibujo del lindero sobre el globo (solo en desarrollo): clic en cada esquina, deshacer, borrar y guardar.
// Guarda en public/capas/lindero-<slug>.geojson con el plugin de astro.config.mjs;
// si el guardado falla, copia el GeoJSON al portapapeles

export type LatLng = { lat: number; lng: number };

/** Área en m² con proyección local equirectangular (suficiente para lotes de pocas hectáreas) */
export function areaM2(puntos: LatLng[]) {
  if (puntos.length < 3) return 0;
  const lat0 = (puntos.reduce((s, p) => s + p.lat, 0) / puntos.length) * (Math.PI / 180);
  const xy = puntos.map((p) => [p.lng * 111_320 * Math.cos(lat0), p.lat * 110_574]);
  let doble = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    doble += x1 * y2 - x2 * y1;
  }
  return Math.abs(doble / 2);
}

export const formatM2 = (m2: number) => `${new Intl.NumberFormat('es-CO').format(Math.round(m2))} m²`;

/** GeoJSON del lindero en [lon, lat], cerrado */
export function geojsonLindero(slug: string, puntos: LatLng[]) {
  const anillo = puntos.map((p) => [Number(p.lng.toFixed(7)), Number(p.lat.toFixed(7))]);
  anillo.push(anillo[0]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { slug, area_m2: Math.round(areaM2(puntos)), dibujado: new Date().toISOString() },
        geometry: { type: 'Polygon', coordinates: [anillo] },
      },
    ],
  };
}

interface OpcionesDibujo {
  mapa: any;
  urlGuardar: string;
  /** Lote abierto en la ficha */
  slug: () => string | undefined;
  /** Lindero vigente del lote abierto */
  actual: () => LatLng[];
  /** Pinta el contorno en el globo mientras se dibuja */
  pintar: (puntos: LatLng[]) => void;
  /** Lindero guardado: el globo lo adopta como vigente */
  alGuardar: (puntos: LatLng[]) => void;
  /** Antes y después de dibujar (vista cenital, ocultar marcadores) */
  alEntrar: () => void;
  alSalir: () => void;
  crearVertice: (p: LatLng) => HTMLElement;
}

export function iniciarDibujo(o: OpcionesDibujo) {
  const caja = document.querySelector<HTMLElement>('[data-dibujo]');
  if (!caja) return { refrescar: () => {}, cancelar: () => {} };
  const $ = (s: string) => caja.querySelector<HTMLElement>(s)!;
  const info = $('[data-dibujo-info]');
  let activo = false;
  let puntos: LatLng[] = [];
  let vertices: HTMLElement[] = [];

  const reposo = () => {
    const pts = o.actual();
    info.textContent = pts.length ? `Lindero actual: ${formatM2(areaM2(pts))}` : 'Sin lindero dibujado';
  };

  const refrescar = () => {
    vertices.forEach((v) => v.remove());
    vertices = puntos.map((p) => {
      const v = o.crearVertice(p);
      o.mapa.append(v);
      return v;
    });
    o.pintar(puntos);
    info.textContent =
      puntos.length < 3 ? `${puntos.length} esquinas, faltan ${3 - puntos.length}` : `${puntos.length} esquinas: ${formatM2(areaM2(puntos))}`;
  };

  const salir = () => {
    activo = false;
    caja.dataset.estado = 'listo';
    vertices.forEach((v) => v.remove());
    vertices = [];
    o.pintar(o.actual());
    reposo();
    o.alSalir();
  };

  o.mapa.addEventListener('gmp-click', (e: any) => {
    if (!activo || !e.position) return;
    puntos.push({ lat: e.position.lat, lng: e.position.lng });
    refrescar();
  });

  $('[data-dibujo-accion="iniciar"]').addEventListener('click', () => {
    if (!o.slug()) return;
    activo = true;
    puntos = [];
    caja.dataset.estado = 'dibujando';
    o.alEntrar();
    refrescar();
  });
  $('[data-dibujo-accion="deshacer"]').addEventListener('click', () => {
    puntos.pop();
    refrescar();
  });
  $('[data-dibujo-accion="borrar"]').addEventListener('click', () => {
    puntos = [];
    refrescar();
  });
  $('[data-dibujo-accion="cancelar"]').addEventListener('click', salir);
  $('[data-dibujo-accion="guardar"]').addEventListener('click', async () => {
    const slug = o.slug();
    if (!slug || puntos.length < 3) {
      info.textContent = 'Marca al menos 3 esquinas';
      return;
    }
    const texto = JSON.stringify(geojsonLindero(slug, puntos));
    let guardado = false;
    try {
      const r = await fetch(o.urlGuardar, { method: 'POST', headers: { 'content-type': 'application/json' }, body: texto });
      guardado = r.ok;
    } catch {
      guardado = false;
    }
    const final = puntos.slice();
    o.alGuardar(final);
    salir();
    if (guardado) info.textContent = `Guardado: ${formatM2(areaM2(final))}`;
    else {
      await navigator.clipboard?.writeText(texto).catch(() => {});
      info.textContent = 'No se pudo guardar en el proyecto. Copié las coordenadas para pegarlas en el chat';
    }
  });

  return { refrescar: reposo, cancelar: () => activo && salir() };
}
