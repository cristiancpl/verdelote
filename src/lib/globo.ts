// Globo de AM Grupo Inmobiliario: llegada con el planeta girando, lotes visibles y clicables a cualquier distancia
// (de lejos agrupados por región), vuelo cinemático al lote como el video publicado, ficha lateral y órbita. La lista y los filtros funcionan también sin el globo (respaldo).
// API: https://developers.google.com/maps/documentation/javascript/3d-maps-overview
import { iniciarDibujo, type LatLng } from './lindero';

interface LoteGlobo {
  id: string;
  nombre: string;
  municipio: string;
  departamento: string;
  vereda?: string;
  areaTxt: string;
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
type Etapa = { umbral: number; titulo: string; sub: string };
type Camara = { center: { lat: number; lng: number; altitude: number }; range: number; tilt: number; heading: number };

declare global {
  interface Window {
    google: any;
    gm_authFailure?: () => void;
  }
}

// Colores de la marca: dorado para lo disponible, gris para reservado, tinta oscura en bordes y números
const DORADO = '#b78f54';
const TINTA = '#14100a';
const GRIS = '#9aa09c';
// Distancias de cámara: lotes uno a uno (más lejos se agrupan por región), nombre de región, municipios y país
const UMBRAL_LOTES = 450_000;
const UMBRAL_NOMBRE_REGION = 120_000;
const UMBRAL_MUNICIPIOS = 160_000;
const UMBRAL_PAIS = 900_000;
// Lotes a menos de 1,5 km entre sí comparten un pin (con el número) hasta que la cámara baja de 25 km
const VECINOS_M = 1_500;
const UMBRAL_VECINOS = 25_000;
// Giro final del vuelo, como en el video: al final rota 35 grados hasta el rumbo de llegada
const GIRO_FINAL = -35;

const suave = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const giroCorto = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

const PLANETA: Camara = { center: { lat: 4.5, lng: -74, altitude: 0 }, range: 17_000_000, tilt: 0, heading: 0 };
const ANTIOQUIA: Camara = { center: { lat: 6.3, lng: -75.47, altitude: 0 }, range: 230_000, tilt: 32, heading: 0 };

const $ = <T extends HTMLElement = HTMLElement>(s: string, raiz: ParentNode = document) => raiz.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, raiz: ParentNode = document) => [...raiz.querySelectorAll<T>(s)];

/** Cargador oficial de la API (bootstrap con callback), sin dependencias */
function cargarMaps(key: string): Promise<void> {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ key, v: 'weekly', language: 'es', region: 'CO', loading: 'async', callback: '__amGloboMaps' });
    (window as any).__amGloboMaps = () => resolve();
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
  // Lotes casi juntos: la cámara baja lo suficiente para que cada pin se vea por separado
  const minimo = radio < VECINOS_M ? 2_400 : 22_000;
  // Centro a la altura de los lotes: de cerca, con altitud 0 la cámara quedaría bajo la montaña
  const altitude = lotes.reduce((s, l) => s + l.alt, 0) / lotes.length;
  return { center: { lat, lng, altitude }, range: Math.min(110_000, Math.max(minimo, radio * 3.4 + 1_400)), tilt: 50, heading: 0 };
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
      // El país se nombra más al sur, para no chocar con el marcador de lotes que sube desde su región
      const c = centroide(mayor);
      const lugar = t.tipo === 'pais' ? { ...c, lat: c.lat - 4.5 } : { ...centroideLotes, lat: centroideLotes.lat + 0.5 };
      etiquetas.push({ m: etiqueta(t.nombre, lugar, t.tipo), tipo: t.tipo });
      programarCapas();
    });
  }
  let municipios: any[] = [];
  capa('municipios', 'rgba(183,143,84,0.75)', 1.5).then(({ lineas }) => {
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
    el.strokeColor = resaltado ? 'rgba(196,158,100,1)' : 'rgba(183,143,84,0.85)';
    el.strokeWidth = resaltado ? 4 : 2;
    el.fillColor = resaltado ? 'rgba(183,143,84,0.32)' : 'rgba(183,143,84,0.16)';
    ruta(el, puntos, 'outerCoordinates');
    if (!el.isConnected) mapa.append(el);
  };
  linderos.forEach((pts, id) => pintarLindero(id, pts));

  // Marcadores: uno por zona (vista Antioquia) y uno por lote con su precio corto (vista zona)
  const pin = (fondo: string, glifo?: string, escala = 1) =>
    new PinElement({ background: fondo, borderColor: TINTA, glyphColor: TINTA, scale: escala, ...(glifo ? { glyphText: glifo } : {}) });
  const colorLote = (l: LoteGlobo, activo: boolean) => (activo ? '#f4f5f3' : l.estado === 'disponible' ? DORADO : GRIS);

  const marcadoresLote = new Map<string, any>();
  for (const l of cfg.lotes) {
    const m = new MarcadorClic({
      position: { lat: l.lat, lng: l.lng, altitude: 40 },
      altitudeMode: 'RELATIVE_TO_GROUND',
      extruded: true,
      sizePreserved: true,
      label: l.precioCorto,
      title: `${l.nombre}, ${l.municipio}`,
    });
    m.append(pin(colorLote(l, false)));
    m.addEventListener('gmp-click', () => irLote(l.id));
    marcadoresLote.set(l.id, m);
  }
  // Grupos de lotes vecinos (mismo proyecto o predios contiguos): un pin con el número y el municipio
  const grupos: { ids: string[]; m: any }[] = [];
  for (const l of cfg.lotes) {
    const g = grupos.find((x) => x.ids.some((id) => metros(porId.get(id)!, l) < VECINOS_M));
    if (g) g.ids.push(l.id);
    else grupos.push({ ids: [l.id], m: undefined });
  }
  const enGrupo = new Map<string, (typeof grupos)[number]>();
  for (const g of grupos.filter((x) => x.ids.length > 1)) {
    const lotesG = g.ids.map((id) => porId.get(id)!);
    const c = centroide(lotesG);
    g.m = new MarcadorClic({
      position: { lat: c.lat, lng: c.lng, altitude: 40 },
      altitudeMode: 'RELATIVE_TO_GROUND',
      extruded: true,
      sizePreserved: true,
      label: lotesG[0].municipio,
      title: `${lotesG.length} lotes en ${lotesG[0].municipio}`,
    });
    g.m.addEventListener('gmp-click', () => volar(camaraGrupo(lotesG), 3000));
    g.ids.forEach((id) => enGrupo.set(id, g));
  }

  const marcarActivo = () =>
    marcadoresLote.forEach((m, id) => {
      m.replaceChildren(pin(colorLote(porId.get(id)!, id === abierto), undefined, id === abierto ? 1.25 : 1));
    });

  // De lejos los lotes se agrupan en un marcador por región con el número de lotes; un clic baja a la región
  const marcadoresRegion = new Map<string, any>();
  for (const r of cfg.territorios.filter((t) => t.tipo === 'region')) {
    const lotesRegion = cfg.lotes.filter((l) => l.departamento === r.nombre);
    if (!lotesRegion.length) continue;
    const c = centroide(lotesRegion);
    const m = new MarcadorClic({
      position: { lat: c.lat, lng: c.lng, altitude: 0 },
      altitudeMode: 'CLAMP_TO_GROUND',
      sizePreserved: true,
      title: `Ver los lotes en ${r.nombre}`,
    });
    m.addEventListener('gmp-click', () => irAntioquia());
    marcadoresRegion.set(r.nombre, m);
  }

  // Qué se ve según la distancia: lotes siempre (uno a uno de cerca, agrupados de lejos), nombres y municipios
  let dibujando = false;
  const mostrar = (m: any, si: boolean) => {
    if (si && !m.isConnected) mapa.append(m);
    else if (!si && m.isConnected) m.remove();
  };
  const actualizarCapas = () => {
    const rango = mapa.range ?? PLANETA.range;
    const cerca = rango <= UMBRAL_LOTES;
    marcadoresRegion.forEach((m, region) => {
      const n = cfg.lotes.filter((l) => l.departamento === region && pasa.has(l.id)).length;
      if (m.dataset.n !== String(n)) {
        m.dataset.n = String(n);
        m.replaceChildren(pin(DORADO, String(n), 1.3));
      }
      mostrar(m, !cerca && n > 0);
    });
    const juntos = rango > UMBRAL_VECINOS;
    for (const g of grupos) {
      if (!g.m) continue;
      const n = g.ids.filter((id) => pasa.has(id)).length;
      if (g.m.dataset.n !== String(n)) {
        g.m.dataset.n = String(n);
        g.m.replaceChildren(pin(DORADO, String(n), 1.15));
      }
      mostrar(g.m, !dibujando && cerca && juntos && n > 1 && !g.ids.includes(abierto ?? ''));
    }
    marcadoresLote.forEach((m, id) => {
      const g = enGrupo.get(id);
      const agrupado = g && juntos && g.ids.filter((x) => pasa.has(x)).length > 1 && !g.ids.includes(abierto ?? '');
      mostrar(m, !dibujando && cerca && !agrupado && (pasa.has(id) || id === abierto));
    });
    for (const e of etiquetas)
      mostrar(e.m, e.tipo === 'pais' ? rango > UMBRAL_PAIS : rango > UMBRAL_NOMBRE_REGION && rango <= UMBRAL_LOTES);
    municipios.forEach((l) => mostrar(l, rango <= UMBRAL_MUNICIPIOS));
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
  let animacion: 'ninguna' | 'vuelo' | 'llegada-lote' | 'orbita' | 'cine' = 'ninguna';
  let cine = 0;
  const marcarOrbita = (si: boolean) => $$('[data-orbitar]').forEach((b) => b.setAttribute('aria-pressed', String(si)));
  const detener = () => {
    if (cine) terminarCine(false);
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
    if (fue === 'llegada-lote') alLlegar();
  });
  $$('[data-orbitar]').forEach((b) => b.addEventListener('click', () => (animacion === 'orbita' ? detener() : orbitar())));

  // Títulos por etapa durante el vuelo (país, región, municipio, vereda, lote), como en el video
  const caja = $('[data-etapa]');
  const tituloEtapa = $('[data-etapa-titulo]');
  const subEtapa = $('[data-etapa-sub]');
  let cambioEtapa = 0;
  const mostrarEtapa = (e?: Etapa) => {
    caja.classList.remove('visible');
    window.clearTimeout(cambioEtapa);
    if (!e) return;
    cambioEtapa = window.setTimeout(() => {
      tituloEtapa.textContent = e.titulo;
      subEtapa.textContent = e.sub;
      caja.classList.add('visible');
    }, 220);
  };
  const etapas = (l: LoteGlobo): Etapa[] => [
    { umbral: 3_000_000, titulo: 'Colombia', sub: 'Sudamérica' },
    { umbral: 300_000, titulo: l.departamento, sub: 'Colombia' },
    { umbral: 30_000, titulo: l.municipio, sub: l.zona.nombre },
    ...(l.vereda ? [{ umbral: 4_000, titulo: l.vereda, sub: l.municipio }] : []),
    { umbral: 1_100, titulo: l.nombre, sub: `${l.areaTxt}, ${l.precioCorto}` },
  ];

  // Vuelo cinemático: la cámara mira siempre al lote; distancia logarítmica, inclinación que crece al acercarse
  // y giro final (la misma curva de prep/vuelo/ges/generar_esp_directo.py). Tocar el globo lo interrumpe
  let alLlegar = () => {};
  let ocultarEtapa = 0;
  // Al llegar, el nombre del lote queda solo un momento; luego entran la lista y la ficha
  const mostrarPaneles = () => {
    window.clearTimeout(ocultarEtapa);
    mostrarEtapa();
    delete raiz.dataset.cine;
  };
  const terminarCine = (llego: boolean) => {
    cancelAnimationFrame(cine);
    cine = 0;
    animacion = 'ninguna';
    programarCapas();
    if (!llego) return mostrarPaneles();
    ocultarEtapa = window.setTimeout(mostrarPaneles, 2400);
    alLlegar();
  };
  const vueloCine = (fin: Camara, l: LoteGlobo, llegada: () => void) => {
    detener();
    const r0 = Math.max(mapa.range ?? PLANETA.range, fin.range);
    const razon = Math.log(r0 / fin.range);
    alLlegar = llegada;
    if (reducido || razon < 0.8) {
      volar(fin, 2500, 'llegada-lote');
      return;
    }
    // LatLngAltitude expone lat/lng como getters: se copian a mano (el spread los pierde)
    const actual = mapa.center ?? PLANETA.center;
    const c0 = { lat: actual.lat, lng: actual.lng, altitude: actual.altitude ?? 0 };
    const t0 = mapa.tilt ?? 0;
    const h0 = mapa.heading ?? 0;
    const dLng = giroCorto(fin.center.lng - c0.lng);
    const dRumbo = giroCorto(fin.heading - GIRO_FINAL - h0);
    const duracion = Math.min(15_000, Math.max(2_800, razon * 1_350));
    const lista = etapas(l).filter((e) => e.umbral < r0 * 0.8);
    let siguiente = 0;
    const inicio = performance.now();
    animacion = 'cine';
    window.clearTimeout(ocultarEtapa);
    raiz.dataset.cine = '';
    const paso = (ahora: number) => {
      const x = Math.min(1, (ahora - inicio) / duracion);
      const p = 0.55 * suave(x) + 0.45 * x;
      const range = Math.exp(Math.log(r0) + (Math.log(fin.range) - Math.log(r0)) * p);
      const pc = suave(x / 0.5);
      Object.assign(mapa, {
        center: {
          lat: c0.lat + (fin.center.lat - c0.lat) * pc,
          lng: c0.lng + dLng * pc,
          altitude: (c0.altitude ?? 0) + (fin.center.altitude - (c0.altitude ?? 0)) * pc,
        },
        range,
        tilt: t0 + (fin.tilt - t0) * suave((p - 0.2) / 0.8),
        heading: h0 + dRumbo * suave(x / 0.6) + GIRO_FINAL * suave((x - 0.72) / 0.28),
      });
      while (siguiente < lista.length && range <= lista[siguiente].umbral) mostrarEtapa(lista[siguiente++]);
      if (x < 1) cine = requestAnimationFrame(paso);
      else terminarCine(true);
    };
    cine = requestAnimationFrame(paso);
  };

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
    if (animacion === 'orbita' || animacion === 'cine') detener();
    if ('cine' in raiz.dataset) mostrarPaneles();
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
  const irLote = (id: string) => {
    const l = porId.get(id);
    if (!l) return;
    girando = false;
    zonaActual = l.zona.id;
    ponerVista('lote');
    ponerMiga(l.zona.id);
    abrirFicha(id);
    hash(id);
    vueloCine(camaraLlegada(l), l, () => {
      // Al llegar, la cámara empieza a girar despacio alrededor del lindero
      if (vista === 'lote' && abierto === id && !dibujando && !angosto.matches) orbitar();
    });
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
          v.append(pin(DORADO, undefined, 0.55));
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
      irLote(h);
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
