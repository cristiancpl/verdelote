// Dibujo del lindero sobre el globo: clic en cada esquina, deshacer, borrar y guardar.
// En desarrollo guarda en public/capas/lindero-<slug>.geojson (plugin en astro.config.mjs);
// si el guardado falla, copia el GeoJSON al portapapeles

type LatLng = { lat: number; lng: number };

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
  slug: string;
  urlGuardar: string;
  /** Pinta el contorno en el globo */
  pintar: (puntos: LatLng[]) => void;
  /** Contorno vigente, para cancelar sin cambios */
  actual: () => LatLng[];
  /** Antes y después de dibujar (ocultar marcador, cambiar vista) */
  alEntrar: () => void;
  alSalir: () => void;
  crearVertice: (p: LatLng) => HTMLElement;
}

export function iniciarDibujo(o: OpcionesDibujo) {
  const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
  const caja = $('[data-dibujo]');
  const info = $('[data-dibujo-info]');
  const btnDibujar = $('[data-dibujo="iniciar"]');
  let activo = false;
  let puntos: LatLng[] = [];
  let vertices: HTMLElement[] = [];

  const resumen = (pts: LatLng[]) =>
    pts.length < 3 ? `${pts.length} esquinas · faltan ${3 - pts.length}` : `${pts.length} esquinas · ${formatM2(areaM2(pts))}`;

  const refrescar = () => {
    vertices.forEach((v) => v.remove());
    vertices = puntos.map((p) => {
      const v = o.crearVertice(p);
      o.mapa.append(v);
      return v;
    });
    o.pintar(puntos);
    info.textContent = activo ? resumen(puntos) : `Lindero actual · ${formatM2(areaM2(o.actual()))}`;
  };

  const salir = () => {
    activo = false;
    caja.dataset.estado = 'listo';
    vertices.forEach((v) => v.remove());
    vertices = [];
    o.pintar(o.actual());
    info.textContent = `Lindero actual · ${formatM2(areaM2(o.actual()))}`;
    o.alSalir();
  };

  o.mapa.addEventListener('gmp-click', (e: any) => {
    if (!activo || !e.position) return;
    e.preventDefault?.();
    puntos.push({ lat: e.position.lat, lng: e.position.lng });
    refrescar();
  });

  btnDibujar.addEventListener('click', () => {
    activo = true;
    puntos = [];
    caja.dataset.estado = 'dibujando';
    o.alEntrar();
    refrescar();
  });
  $('[data-dibujo="deshacer"]').addEventListener('click', () => {
    puntos.pop();
    refrescar();
  });
  $('[data-dibujo="borrar"]').addEventListener('click', () => {
    puntos = [];
    refrescar();
  });
  $('[data-dibujo="cancelar"]').addEventListener('click', salir);
  $('[data-dibujo="guardar"]').addEventListener('click', async () => {
    if (puntos.length < 3) {
      info.textContent = 'Marca al menos 3 esquinas';
      return;
    }
    const geo = geojsonLindero(o.slug, puntos);
    const texto = JSON.stringify(geo);
    try {
      localStorage.setItem(`lindero-${o.slug}`, texto);
    } catch {}
    let guardado = false;
    try {
      const r = await fetch(o.urlGuardar, { method: 'POST', headers: { 'content-type': 'application/json' }, body: texto });
      guardado = r.ok;
    } catch {}
    const final = puntos.slice();
    o.actual = () => final;
    salir();
    if (guardado) info.textContent = `Guardado · ${formatM2(areaM2(final))}`;
    else {
      await navigator.clipboard?.writeText(texto).catch(() => {});
      info.textContent = `No se pudo guardar en el repo. Copié las coordenadas: pégalas en el chat`;
    }
  });

  info.textContent = `Lindero actual · ${formatM2(areaM2(o.actual()))}`;
}
