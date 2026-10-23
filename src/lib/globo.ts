// Prueba técnica del globo (fase 1): carga Maps 3D, dibuja capas y vuela al lote.
// API: https://developers.google.com/maps/documentation/javascript/3d-maps-overview
import { iniciarDibujo } from './lindero';

interface ConfigGlobo {
  key: string;
  capas: string;
  /** Herramienta de dibujo del lindero (solo en desarrollo) y URL donde se guarda */
  dibujo: boolean;
  guardar: string;
  lote: {
    slug: string;
    nombre: string;
    precio: string;
    lat: number;
    lng: number;
    alt: number;
    camara: { range: number; tilt: number; heading: number };
    contorno: [number, number][];
  };
}

type LatLngAlt = { lat: number; lng: number; altitude: number };
type Camara = { center: LatLngAlt; range: number; tilt: number; heading: number };

declare global {
  interface Window {
    VERDELOTE_GLOBO: ConfigGlobo;
    google: any;
  }
}

/** Cargador oficial de la API (bootstrap dinámico), sin dependencias */
function cargarMaps(key: string): Promise<void> {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ key, v: 'weekly', language: 'es', region: 'CO', loading: 'async', callback: '__verdeloteMaps' });
    (window as any).__verdeloteMaps = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => reject(new Error('No cargó la API de Maps'));
    document.head.append(s);
  });
}

const VISTAS: Record<string, Camara> = {
  planeta: { center: { lat: 4.5, lng: -74, altitude: 0 }, range: 16_000_000, tilt: 0, heading: 0 },
  colombia: { center: { lat: 4.2, lng: -73.5, altitude: 0 }, range: 2_600_000, tilt: 0, heading: 0 },
  antioquia: { center: { lat: 6.7, lng: -75.6, altitude: 0 }, range: 520_000, tilt: 25, heading: 0 },
};

/** Lee los anillos exteriores de un GeoJSON de public/capas como [{lat, lng}] */
async function anillos(base: string, nombre: string) {
  const geo = await fetch(`${base}${nombre}.geojson`).then((r) => r.json());
  return geo.features.flatMap((f: any) =>
    f.geometry.coordinates.map((poly: number[][][]) => poly[0].map(([lng, lat]) => ({ lat, lng }))),
  );
}

/** La API renombró outerCoordinates/coordinates a path; se usa lo que exista */
function asignarRuta(el: any, ruta: object[], viejo: 'outerCoordinates' | 'coordinates') {
  if ('path' in el) el.path = ruta;
  else el[viejo] = ruta;
}

export async function iniciarGlobo(contenedor: HTMLElement, medidas: HTMLElement) {
  const cfg = window.VERDELOTE_GLOBO;
  const log = (t: string) => (medidas.textContent = t);
  if (!cfg.key) {
    log('Falta PUBLIC_GOOGLE_MAPS_KEY en .env');
    return;
  }

  const t0 = performance.now();
  await cargarMaps(cfg.key);
  const maps3d = await window.google.maps.importLibrary('maps3d');
  const { Map3DElement, Polygon3DElement, Polyline3DElement } = maps3d;
  const Marcador = maps3d.Marker3DInteractiveElement ?? maps3d.Marker3DElement;

  const mapa = new Map3DElement({ ...VISTAS.planeta, mode: 'HYBRID' });
  contenedor.append(mapa);
  (window as any).mapa = mapa;

  const { lote } = cfg;
  const centroLote = { lat: lote.lat, lng: lote.lng, altitude: lote.alt };
  const camaraLote: Camara = { center: centroLote, ...lote.camara };

  // Capas: país y departamento como línea sobre el terreno; municipio y lote como polígonos
  const linea = (ruta: object[], color: string, ancho: number) => {
    const el = new Polyline3DElement({ altitudeMode: 'CLAMP_TO_GROUND', strokeColor: color, strokeWidth: ancho, drawsOccludedSegments: true });
    asignarRuta(el, ruta, 'coordinates');
    mapa.append(el);
  };
  const [colombia, antioquia, girardota] = await Promise.all(
    ['colombia', 'antioquia', 'girardota'].map((n) => anillos(cfg.capas, n)),
  );
  colombia.forEach((r: object[]) => linea(r, 'rgba(255,255,255,0.9)', 3));
  antioquia.forEach((r: object[]) => linea(r, 'rgba(255,255,255,0.7)', 2));
  girardota.forEach((r: object[]) => linea(r, 'rgba(108,193,122,0.9)', 2));

  const poligono = new Polygon3DElement({
    altitudeMode: 'CLAMP_TO_GROUND',
    strokeColor: 'rgba(108,193,122,1)',
    strokeWidth: 4,
    fillColor: 'rgba(108,193,122,0.28)',
    drawsOccludedSegments: true,
  });
  // Lindero dibujado en el globo (public/capas/lindero-<slug>.geojson); si no existe, el contorno aproximado
  let contorno = lote.contorno.map(([lng, lat]) => ({ lat, lng }));
  try {
    const r = await fetch(`${cfg.capas}lindero-${lote.slug}.geojson?v=${Date.now()}`);
    if (r.ok) {
      const geo = await r.json();
      contorno = geo.features[0].geometry.coordinates[0].slice(0, -1).map(([lng, lat]: number[]) => ({ lat, lng }));
    }
  } catch {}
  const pintarLindero = (pts: { lat: number; lng: number }[]) => {
    asignarRuta(poligono, pts.length ? pts : [], 'outerCoordinates');
    if (!poligono.isConnected && pts.length) mapa.append(poligono);
  };
  pintarLindero(contorno);

  const marcador = new Marcador({
    position: { lat: lote.lat, lng: lote.lng, altitude: 60 },
    altitudeMode: 'RELATIVE_TO_GROUND',
    extruded: true,
    label: `${lote.nombre.replace(/^Lote\s+/, '')} · ${lote.precio}`,
  });
  mapa.append(marcador);

  // Vuelo y medidas
  let vueloInicio = 0;
  const volar = (cam: Camara, ms = 3500) => {
    mapa.stopCameraAnimation?.();
    vueloInicio = performance.now();
    mapa.flyCameraTo({ endCamera: cam, durationMillis: ms });
  };
  const irLote = () => {
    volar(camaraLote, 4000);
    history.replaceState(null, '', `#${lote.slug}`);
  };
  const orbitar = () => mapa.flyCameraAround({ camera: camaraLote, durationMillis: 40_000, repeatCount: 1, rounds: 1 });

  marcador.addEventListener('gmp-click', irLote);
  mapa.addEventListener('gmp-animationend', () => {
    if (vueloInicio) estado.ultimoVuelo = `${((performance.now() - vueloInicio) / 1000).toFixed(1)} s`;
    vueloInicio = 0;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-ir]').forEach((b) =>
    b.addEventListener('click', () => {
      const ir = b.dataset.ir!;
      if (ir === 'lote') irLote();
      else if (ir === 'orbita') orbitar();
      else volar(VISTAS[ir]);
    }),
  );

  const estado = { fps: 0, ultimoVuelo: '-', carga: '' };
  mapa.addEventListener('gmp-steadychange', (e: any) => {
    if (e.isSteady && !estado.carga) estado.carga = `${((performance.now() - t0) / 1000).toFixed(1)} s`;
  });
  let cuadros = 0;
  let marca = performance.now();
  const medir = (ahora: number) => {
    cuadros++;
    if (ahora - marca >= 1000) {
      estado.fps = Math.round((cuadros * 1000) / (ahora - marca));
      cuadros = 0;
      marca = ahora;
      const c = mapa.center;
      log(
        `fps ${estado.fps}  ·  primera vista estable ${estado.carga || '…'}\n` +
          `último vuelo ${estado.ultimoVuelo}\n` +
          `cámara ${c ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : '-'}  rango ${Math.round(mapa.range ?? 0)} m  tilt ${Math.round(mapa.tilt ?? 0)}`,
      );
    }
    requestAnimationFrame(medir);
  };
  requestAnimationFrame(medir);

  if (cfg.dibujo) {
    const { PinElement } = await window.google.maps.importLibrary('marker');
    const { Marker3DElement } = maps3d;
    let modoPrevio = mapa.mode;
    iniciarDibujo({
      mapa,
      slug: lote.slug,
      urlGuardar: cfg.guardar,
      pintar: pintarLindero,
      actual: () => contorno,
      crearVertice: (p) => {
        const v = new Marker3DElement({ position: { ...p, altitude: 0 }, altitudeMode: 'CLAMP_TO_GROUND' });
        v.append(new PinElement({ scale: 0.55, background: '#6cc17a', borderColor: '#08130b', glyphColor: '#08130b' }));
        return v;
      },
      alEntrar: () => {
        marcador.remove();
        modoPrevio = mapa.mode;
        mapa.mode = 'SATELLITE';
        // Vista cenital sobre el lote: cada clic cae donde se ve
        volar({ center: centroLote, range: 420, tilt: 0, heading: 0 }, 2500);
      },
      alSalir: () => {
        mapa.append(marcador);
        mapa.mode = modoPrevio;
      },
    });
  }

  // Enlace profundo: /globo/#mirador-del-valle llega directo al lote
  if (location.hash === `#${lote.slug}`) {
    Object.assign(mapa, { ...camaraLote, range: camaraLote.range * 3 });
    volar(camaraLote, 1500);
  }
}
