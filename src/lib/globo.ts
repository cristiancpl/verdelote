// Globo de Verdelote: llegada con el planeta girando, vista Antioquia con zonas, vista zona con lotes,
// vuelo al lote con ficha lateral y órbita. La lista y los filtros funcionan también sin el globo (respaldo).
// API: https://developers.google.com/maps/documentation/javascript/3d-maps-overview
import { iniciarDibujo, type LatLng } from './lindero';

interface LoteGlobo {
  id: string;
  nombre: string;
  municipio: string;
  zona: { id: string; nombre: string };
  lat: number;
  lng: number;
  alt: number;
  camara?: { range: number; tilt: number; heading: number };
  area: number;
  precio: number;
  precioCorto: string;
  estado: 'disponible' | 'reservado' | 'vendido';
  demo: boolean;
  recorrido: boolean;
  lindero: LatLng[];
}

interface Territorio {
  nombre: string;
  tipo: 'pais' | 'region';
  capa: string;
}

interface ConfigGlobo {
  key: string;
  territorios: Territorio[];
  capas: string;
  dibujo: boolean;
  guardar: string;
  lotes: LoteGlobo[];
}

type Vista = 'llegada' | 'mapa' | 'zona' | 'lote';
type Camara = { center: { lat: number; lng: number; altitude: number }; range: number; tilt: number; heading: number };

declare global {
  interface Window {
    google: any;
    gm_authFailure?: () => void;
  }
}

const VERDE = '#6cc17a';
const TINTA = '#08130b';
const AMBAR = '#e3b65c';
// Distancias de cámara: lotes en lugar de zonas, nombre de región y zonas, nombre de país
const UMBRAL_LOTES = 160_000;
const UMBRAL_REGION = 3_000_000;
const UMBRAL_PAIS = 900_000;

const PLANETA: Camara = { center: { lat: 4.5, lng: -74, altitude: 0 }, range: 17_000_000, tilt: 0, heading: 0 };
const ANTIOQUIA: Camara = { center: { lat: 6.3, lng: -75.47, altitude: 0 }, range: 230_000, tilt: 32, heading: 0 };

const $ = <T extends HTMLElement = HTMLElement>(s: string, raiz: ParentNode = document) => raiz.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, raiz: ParentNode = document) => [...raiz.querySelectorAll<T>(s)];

/** Cargador oficial de la API (bootstrap con callback), sin dependencias */
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

const soportaWebGL = () => {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
};

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Distancia aproximada en metros entre dos puntos cercanos */
const metros = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot((a.lat - b.lat) * 110_574, (a.lng - b.lng) * 111_320 * k);
};

/** Cámara que encuadra un grupo de lotes */
function camaraGrupo(lotes: LoteGlobo[]): Camara {
  const lat = lotes.reduce((s, l) => s + l.lat, 0) / lotes.length;
  const lng = lotes.reduce((s, l) => s + l.lng, 0) / lotes.length;
  const radio = Math.max(0, ...lotes.map((l) => metros({ lat, lng }, l)));
  return { center: { lat, lng, altitude: 0 }, range: Math.min(110_000, Math.max(22_000, radio * 3.4 + 14_000)), tilt: 50, heading: 0 };
}

const camaraLote = (l: LoteGlobo): Camara => ({
  center: { lat: l.lat, lng: l.lng, altitude: l.alt },
  ...(l.camara ?? { range: 650, tilt: 60, heading: 0 }),
});

export async function iniciarGlobo() {
  const cfg: ConfigGlobo = JSON.parse($('#globo-config').textContent ?? '{}');
  const raiz = $('[data-globo]');
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const porId = new Map(cfg.lotes.map((l) => [l.id, l]));
  const zonas = [...new Map(cfg.lotes.map((l) => [l.zona.id, l.zona])).values()];
  const linderos = new Map(cfg.lotes.map((l) => [l.id, l.lindero]));

  let vista: Vista = 'llegada';
  let abierto: string | undefined;
  let zonaActual: string | undefined;
  const pasa = new Set(cfg.lotes.map((l) => l.id));

  const ponerVista = (v: Vista) => {
    vista = v;
    raiz.dataset.vista = v;
  };

  // Lista y filtros: funcionan con o sin globo
  const buscar = $<HTMLInputElement>('[data-buscar]');
  const fMunicipio = $<HTMLSelectElement>('[data-f-municipio]');
  const fArea = $<HTMLSelectElement>('[data-f-area]');
  const fPrecio = $<HTMLSelectElement>('[data-f-precio]');
  const fRecorrido = $<HTMLInputElement>('[data-f-recorrido]');
  let alFiltrar = () => {};

  const filtrar = () => {
    const q = normalizar(buscar.value.trim());
    const area = Number(fArea.value) || 0;
    const precio = Number(fPrecio.value) || Infinity;
    pasa.clear();
    for (const l of cfg.lotes) {
      const ok =
        (!q || normalizar(`${l.nombre} ${l.municipio} ${l.zona.nombre}`).includes(q)) &&
        (!fMunicipio.value || l.municipio === fMunicipio.value) &&
        l.area >= area &&
        l.precio <= precio &&
        (!fRecorrido.checked || l.recorrido);
      if (ok) pasa.add(l.id);
      $(`[data-item="${l.id}"]`).hidden = !ok;
    }
    for (const z of zonas) {
      const n = cfg.lotes.filter((l) => l.zona.id === z.id && pasa.has(l.id)).length;
      $(`[data-grupo="${z.id}"]`).hidden = n === 0;
      $(`[data-grupo="${z.id}"] [data-grupo-n]`).textContent = n === 1 ? '1 lote' : `${n} lotes`;
    }
    $('[data-conteo]').textContent = pasa.size === 1 ? '1 lote' : `${pasa.size} lotes`;
    $('[data-vacio]').hidden = pasa.size > 0;
    const activos = [fMunicipio.value, fArea.value, fPrecio.value, fRecorrido.checked].filter(Boolean).length;
    const n = $('[data-filtros-n]');
    n.hidden = activos === 0;
    n.textContent = String(activos);
    alFiltrar();
  };
  [buscar, fMunicipio, fArea, fPrecio, fRecorrido].forEach((el) => el.addEventListener('input', filtrar));
  $('[data-limpiar]').addEventListener('click', () => {
    buscar.value = '';
    fMunicipio.value = fArea.value = fPrecio.value = '';
    fRecorrido.checked = false;
    filtrar();
  });
  const btnFiltros = $('[data-filtros-toggle]');
  btnFiltros.addEventListener('click', () => {
    const abrir = btnFiltros.getAttribute('aria-expanded') !== 'true';
    btnFiltros.setAttribute('aria-expanded', String(abrir));
    $('[data-filtros]').hidden = !abrir;
  });
  const rail = $('[data-rail]');
  const btnRail = $('[data-rail-toggle]');
  btnRail.addEventListener('click', () => {
    const plegar = !rail.hasAttribute('data-plegado');
    rail.toggleAttribute('data-plegado', plegar);
    btnRail.setAttribute('aria-expanded', String(!plegar));
  });
  filtrar();

  const migaZona = $('[data-miga-zona]');
  const ponerMiga = (zonaId?: string) => {
    const z = zonas.find((x) => x.id === zonaId);
    migaZona.hidden = !z;
    migaZona.textContent = z?.nombre ?? '';
  };

  // Ficha lateral
  const ficha = $('[data-ficha]');
  let alAbrir = (_id: string) => {};
  let alCerrar = () => {};
  const abrirFicha = (id: string) => {
    abierto = id;
    ficha.hidden = false;
    $$('[data-ficha-lote]').forEach((a) => (a.hidden = a.dataset.fichaLote !== id));
    $$('[data-abrir]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.abrir === id)));
    const h2 = $(`[data-ficha-lote="${id}"] h2`);
    h2.tabIndex = -1;
    h2.focus({ preventScroll: true });
    ficha.scrollTop = 0;
    alAbrir(id);
  };
  const cerrarFicha = () => {
    if (!abierto) return;
    const previo = abierto;
    abierto = undefined;
    ficha.hidden = true;
    $$('[data-abrir]').forEach((b) => b.setAttribute('aria-current', 'false'));
    $(`[data-abrir="${previo}"]`)?.focus({ preventScroll: true });
    alCerrar();
  };

  // Recorrido en video
  const dialogo = $<HTMLDialogElement>('[data-video]');
  const video = $<HTMLVideoElement>('[data-video-el]');
  $$('[data-recorrido]').forEach((b) =>
    b.addEventListener('click', () => {
      video.poster = b.dataset.poster ?? '';
      video.src = b.dataset.recorrido!;
      dialogo.showModal();
      video.play().catch(() => {});
    }),
  );
  dialogo.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
  $('[data-video-cerrar]').addEventListener('click', () => dialogo.close());

  // Respaldo: sin clave, sin WebGL o con la clave rechazada se ofrece la lista del sitio
  const respaldo = () => {
    ponerVista('llegada');
    $('[data-explorar]').hidden = true;
    $('[data-respaldo-aviso]').hidden = false;
    const fondo = document.querySelector<HTMLElement>('[data-fondo]');
    if (fondo) fondo.hidden = false;
    $('[data-lienzo]').replaceChildren();
  };
  if (!cfg.key || !soportaWebGL()) {
    respaldo();
    return;
  }
  window.gm_authFailure = respaldo;

  try {
    await cargarMaps(cfg.key);
  } catch {
    respaldo();
    return;
  }
  const maps3d = await window.google.maps.importLibrary('maps3d');
  const { PinElement } = await window.google.maps.importLibrary('marker');
  const { Map3DElement, Polygon3DElement, Polyline3DElement, Marker3DElement } = maps3d;
  const MarcadorClic = maps3d.Marker3DInteractiveElement ?? Marker3DElement;

  // Satélite sin etiquetas de Google: solo se nombran los países y regiones donde hay lotes
  const mapa = new Map3DElement({ ...PLANETA, mode: 'SATELLITE' });
  $('[data-lienzo]').append(mapa);
  // En celular la lista y la ficha ocupan la parte baja: se ocultan brújula y pantalla completa (la atribución queda)
  const angosto = matchMedia('(max-width: 767px)');
  const ajustarUI = () => (mapa.defaultUIHidden = angosto.matches);
  ajustarUI();
  angosto.addEventListener('change', ajustarUI);

  // La API renombró outerCoordinates/coordinates a path; se usa lo que exista
  const ruta = (el: any, puntos: object[], viejo: 'outerCoordinates' | 'coordinates') => {
    if ('path' in el) el.path = puntos;
    else el[viejo] = puntos;
  };

  // Capas de contexto: contorno y nombre de cada país y región con lotes; municipios solo de cerca
  const capa = async (nombre: string, color: string, ancho: number) => {
    const geo = await fetch(`${cfg.capas}${nombre}.geojson`).then((r) => r.json());
    const anillos: LatLng[][] = geo.features.flatMap((f: any) =>
      f.geometry.coordinates.map((poly: number[][][]) => poly[0].map(([lng, lat]) => ({ lat, lng }))),
    );
    const lineas = anillos.map((a) => {
      const el = new Polyline3DElement({ altitudeMode: 'CLAMP_TO_GROUND', strokeColor: color, strokeWidth: ancho, drawsOccludedSegments: true });
      ruta(el, a, 'coordinates');
      return el;
    });
    return { anillos, lineas };
  };
  // Nombre sin pin: el marcador lleva un SVG con el texto (la etiqueta nativa es muy pequeña y no se ve desde el espacio)
  const etiqueta = (nombre: string, p: LatLng, tipo: Territorio['tipo']) => {
    const fs = tipo === 'pais' ? 26 : 19;
    const ancho = Math.ceil(nombre.length * fs * 0.62 + 24);
    const alto = Math.ceil(fs * 1.6);
    const texto = nombre.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}">` +
      `<text x="50%" y="${fs * 1.15}" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" ` +
      `font-size="${fs}" font-weight="500" letter-spacing="${tipo === 'pais' ? 0.5 : 0.2}" fill="#f4f5f3" ` +
      `stroke="rgba(11,12,13,0.55)" stroke-width="${fs / 7}" paint-order="stroke">${texto}</text></svg>`;
    // sizePreserved: el nombre conserva su tamaño aunque la cámara esté a miles de kilómetros
    const m = new Marker3DElement({ position: { ...p, altitude: 0 }, altitudeMode: 'CLAMP_TO_GROUND', sizePreserved: true });
    const plantilla = document.createElement('template');
    plantilla.innerHTML = svg;
    m.append(plantilla);
    return m;
  };
  const centroide = (a: LatLng[]) => ({ lat: a.reduce((s, p) => s + p.lat, 0) / a.length, lng: a.reduce((s, p) => s + p.lng, 0) / a.length });
  const etiquetas: { m: any; tipo: Territorio['tipo'] }[] = [];
  const centroideLotes = centroide(cfg.lotes);
  for (const t of cfg.territorios) {
    capa(t.capa, t.tipo === 'pais' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.75)', t.tipo === 'pais' ? 3 : 2).then(({ anillos, lineas }) => {
      lineas.forEach((l) => mapa.append(l));
      const mayor = anillos.reduce((a, b) => (b.length > a.length ? b : a));
      // La región se nombra un poco al norte de sus lotes, para que quede a la vista sobre las zonas
      const lugar = t.tipo === 'pais' ? centroide(mayor) : { ...centroideLotes, lat: centroideLotes.lat + 0.5 };
      etiquetas.push({ m: etiqueta(t.nombre, lugar, t.tipo), tipo: t.tipo });
      programarCapas();
    });
  }
  let municipios: any[] = [];
  capa('municipios', 'rgba(108,193,122,0.75)', 1.5).then(({ lineas }) => {
    municipios = lineas;
    programarCapas();
  });

  // Linderos de los lotes
  const poligonos = new Map<string, any>();
  const pintarLindero = (id: string, puntos: LatLng[], resaltado = id === abierto) => {
    let el = poligonos.get(id);
    if (puntos.length < 3) {
      el?.remove();
      return;
    }
    if (!el) {
      el = new Polygon3DElement({ altitudeMode: 'CLAMP_TO_GROUND', drawsOccludedSegments: true });
      poligonos.set(id, el);
    }
    el.strokeColor = resaltado ? 'rgba(108,193,122,1)' : 'rgba(108,193,122,0.8)';
    el.strokeWidth = resaltado ? 4 : 2;
    el.fillColor = resaltado ? 'rgba(108,193,122,0.32)' : 'rgba(108,193,122,0.16)';
    ruta(el, puntos, 'outerCoordinates');
    if (!el.isConnected) mapa.append(el);
  };
  linderos.forEach((pts, id) => pintarLindero(id, pts));

  // Marcadores: uno por zona (vista Antioquia) y uno por lote con su precio corto (vista zona)
  const pin = (fondo: string, glifo?: string, escala = 1) =>
    new PinElement({ background: fondo, borderColor: TINTA, glyphColor: TINTA, scale: escala, ...(glifo ? { glyphText: glifo } : {}) });
  const colorLote = (l: LoteGlobo, activo: boolean) => (activo ? '#f4f5f3' : l.estado === 'disponible' ? VERDE : AMBAR);

  const marcadoresLote = new Map<string, any>();
  for (const l of cfg.lotes) {
    const m = new MarcadorClic({
      position: { lat: l.lat, lng: l.lng, altitude: 40 },
      altitudeMode: 'RELATIVE_TO_GROUND',
      extruded: true,
      label: l.precioCorto,
      title: `${l.nombre}, ${l.municipio}`,
    });
    m.append(pin(colorLote(l, false)));
    m.addEventListener('gmp-click', () => irLote(l.id));
    marcadoresLote.set(l.id, m);
  }
  const marcarActivo = () =>
    marcadoresLote.forEach((m, id) => {
      m.replaceChildren(pin(colorLote(porId.get(id)!, id === abierto), undefined, id === abierto ? 1.25 : 1));
    });

  const marcadoresZona = new Map<string, any>();
  for (const z of zonas) {
    const c = camaraGrupo(cfg.lotes.filter((l) => l.zona.id === z.id)).center;
    const m = new MarcadorClic({
      position: { lat: c.lat, lng: c.lng, altitude: 0 },
      altitudeMode: 'CLAMP_TO_GROUND',
      label: z.nombre,
      title: `Ver lotes en ${z.nombre}`,
    });
    m.addEventListener('gmp-click', () => irZona(z.id));
    marcadoresZona.set(z.id, m);
  }

  // Qué se ve según la distancia: país de lejos, región y zonas en medio, municipios y lotes de cerca
  let dibujando = false;
  const mostrar = (m: any, si: boolean) => {
    if (si && !m.isConnected) mapa.append(m);
    else if (!si && m.isConnected) m.remove();
  };
  const actualizarCapas = () => {
    const rango = mapa.range ?? PLANETA.range;
    const cerca = rango <= UMBRAL_LOTES;
    for (const z of zonas) {
      const n = cfg.lotes.filter((l) => l.zona.id === z.id && pasa.has(l.id)).length;
      const m = marcadoresZona.get(z.id);
      if (m.dataset.n !== String(n)) {
        m.dataset.n = String(n);
        m.replaceChildren(pin(VERDE, String(n), 1.3));
      }
      mostrar(m, vista !== 'llegada' && !cerca && n > 0 && rango < UMBRAL_REGION);
    }
    marcadoresLote.forEach((m, id) => mostrar(m, !dibujando && cerca && (pasa.has(id) || id === abierto)));
    for (const e of etiquetas) mostrar(e.m, e.tipo === 'pais' ? rango > UMBRAL_PAIS : rango < UMBRAL_REGION && !cerca);
    municipios.forEach((l) => mostrar(l, cerca));
  };
  let pendiente = false;
  const programarCapas = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      actualizarCapas();
    });
  };
  mapa.addEventListener('gmp-rangechange', programarCapas);
  alFiltrar = programarCapas;

  // Cámara
  let animacion: 'ninguna' | 'vuelo' | 'llegada-lote' | 'orbita' = 'ninguna';
  const marcarOrbita = (si: boolean) => $$('[data-orbitar]').forEach((b) => b.setAttribute('aria-pressed', String(si)));
  const detener = () => {
    mapa.stopCameraAnimation?.();
    if (animacion === 'orbita') marcarOrbita(false);
    animacion = 'ninguna';
  };
  const volar = (cam: Camara, ms: number, tipo: typeof animacion = 'vuelo') => {
    detener();
    if (reducido) {
      Object.assign(mapa, cam);
      programarCapas();
      return;
    }
    animacion = tipo;
    mapa.flyCameraTo({ endCamera: cam, durationMillis: ms });
  };
  // En celular la ficha tapa la mitad baja: el centro de la cámara se corre hacia quien mira y el lote sube en pantalla
  const camaraLlegada = (l: LoteGlobo): Camara => {
    const cam = camaraLote(l);
    if (!angosto.matches) return cam;
    const k = cam.range * 0.3;
    const h = (cam.heading * Math.PI) / 180;
    const lat = cam.center.lat - (k * Math.cos(h)) / 110_574;
    const lng = cam.center.lng - (k * Math.sin(h)) / (111_320 * Math.cos((cam.center.lat * Math.PI) / 180));
    return { ...cam, center: { ...cam.center, lat, lng } };
  };
  const orbitar = () => {
    if (!abierto || reducido) return;
    detener();
    animacion = 'orbita';
    marcarOrbita(true);
    mapa.flyCameraAround({ camera: camaraLote(porId.get(abierto)!), durationMillis: 60_000, repeatCount: 1 });
  };
  mapa.addEventListener('gmp-animationend', () => {
    const fue = animacion;
    animacion = 'ninguna';
    if (fue === 'orbita') marcarOrbita(false);
    // Al llegar al lote, la cámara empieza a girar despacio alrededor del lindero
    if (fue === 'llegada-lote' && vista === 'lote' && !dibujando && !angosto.matches) orbitar();
  });
  $$('[data-orbitar]').forEach((b) => b.addEventListener('click', () => (animacion === 'orbita' ? detener() : orbitar())));

  // Llegada: el planeta gira en su sentido real (de oeste a este) y frena con Colombia a la derecha del título;
  // en celular el título va abajo y Colombia queda al centro
  const giroHasta = angosto.matches ? PLANETA.center.lng : PLANETA.center.lng - 22;
  const giroDesde = giroHasta + 70;
  let girando = !reducido;
  const giroInicio = performance.now();
  const girar = (ahora: number) => {
    if (!girando || vista !== 'llegada') return;
    const t = Math.min(1, (ahora - giroInicio) / 22_000);
    const suave = 1 - (1 - t) ** 3;
    mapa.center = { lat: PLANETA.center.lat, lng: giroDesde + (giroHasta - giroDesde) * suave, altitude: 0 };
    if (t < 1) requestAnimationFrame(girar);
  };
  mapa.center = { ...PLANETA.center, lng: reducido ? giroHasta : giroDesde };
  requestAnimationFrame(girar);
  $('[data-lienzo]').addEventListener('pointerdown', () => {
    girando = false;
    if (animacion === 'orbita') detener();
  });

  const hash = (h: string) => history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);

  const irAntioquia = (ms = 4500) => {
    girando = false;
    cerrarFicha();
    zonaActual = undefined;
    ponerVista('mapa');
    ponerMiga();
    volar(ANTIOQUIA, ms);
    hash('');
    programarCapas();
  };
  const irZona = (id: string, ms = 3000) => {
    const lotesZona = cfg.lotes.filter((l) => l.zona.id === id && pasa.has(l.id));
    if (!lotesZona.length) return;
    girando = false;
    cerrarFicha();
    zonaActual = id;
    ponerVista('zona');
    ponerMiga(id);
    volar(camaraGrupo(lotesZona), ms);
    hash(`zona-${id}`);
  };
  const irLote = (id: string, ms = 4000) => {
    const l = porId.get(id);
    if (!l) return;
    girando = false;
    zonaActual = l.zona.id;
    ponerVista('lote');
    ponerMiga(l.zona.id);
    abrirFicha(id);
    volar(camaraLlegada(l), ms, 'llegada-lote');
    hash(id);
  };
  const volverAlMapa = () => {
    const zona = zonaActual;
    cerrarFicha();
    if (zona) irZona(zona, 2500);
    else irAntioquia(2500);
  };

  // Herramienta de lindero (solo en desarrollo)
  const dibujo = cfg.dibujo
    ? iniciarDibujo({
        mapa,
        urlGuardar: cfg.guardar,
        slug: () => abierto,
        actual: () => (abierto ? linderos.get(abierto) ?? [] : []),
        pintar: (pts) => {
          if (abierto) pintarLindero(abierto, pts, true);
        },
        alGuardar: (pts) => {
          if (abierto) linderos.set(abierto, pts);
        },
        alEntrar: () => {
          dibujando = true;
          const l = porId.get(abierto!)!;
          volar({ center: { lat: l.lat, lng: l.lng, altitude: l.alt }, range: 420, tilt: 0, heading: 0 }, 2000);
          programarCapas();
        },
        alSalir: () => {
          dibujando = false;
          programarCapas();
        },
        crearVertice: (p) => {
          const v = new Marker3DElement({ position: { ...p, altitude: 0 }, altitudeMode: 'CLAMP_TO_GROUND' });
          v.append(pin(VERDE, undefined, 0.55));
          return v;
        },
      })
    : { refrescar: () => {}, cancelar: () => {} };

  alAbrir = (id) => {
    marcarActivo();
    linderos.forEach((pts, x) => pintarLindero(x, pts, x === id));
    dibujo.refrescar();
    programarCapas();
  };
  alCerrar = () => {
    dibujo.cancelar();
    detener();
    marcarActivo();
    linderos.forEach((pts, x) => pintarLindero(x, pts, false));
    programarCapas();
  };

  $('[data-explorar]').addEventListener('click', () => irAntioquia());
  $('[data-ir-antioquia]').addEventListener('click', () => irAntioquia(2500));
  $$('[data-ir-zona]').forEach((b) => b.addEventListener('click', () => irZona(b.dataset.irZona!)));
  $$('[data-abrir]').forEach((b) => b.addEventListener('click', () => irLote(b.dataset.abrir!)));
  $$('[data-volver]').forEach((b) => b.addEventListener('click', volverAlMapa));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierto && !dialogo.open) volverAlMapa();
  });

  // Enlaces profundos: #<lote> abre el lote y #zona-<id> la zona, sin pasar por la llegada
  const abrirDesdeHash = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (porId.has(h)) {
      if (h === abierto) return;
      const cam = camaraLlegada(porId.get(h)!);
      Object.assign(mapa, { ...cam, range: cam.range * 6, tilt: Math.max(0, cam.tilt - 20) });
      irLote(h, 2500);
    } else if (h.startsWith('zona-') && zonas.some((z) => z.id === h.slice(5))) {
      if (vista === 'zona' && zonaActual === h.slice(5)) return;
      Object.assign(mapa, ANTIOQUIA);
      irZona(h.slice(5), 2500);
    }
  };
  abrirDesdeHash();
  window.addEventListener('hashchange', abrirDesdeHash);
  programarCapas();
}
