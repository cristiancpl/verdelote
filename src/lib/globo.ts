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
  /** Lotes reales del proyecto (1 si es un predio sin parcelación) */
  unidades: number;
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
// Distancia de cámara desde la que los lotes se ven uno a uno (más lejos se agrupan por región)
const UMBRAL_LOTES = 450_000;
// Municipio al que vuela "Explorar lotes" desde la llegada
const MUNICIPIO_ENTRADA = 'Guarne';
// Lotes a menos de 1,5 km entre sí comparten un pin (con el número) hasta que la cámara baja de 25 km
const VECINOS_M = 1_500;
const UMBRAL_VECINOS = 25_000;
// Tiempo con la cámara quieta y sin señal de vida del mapa (gmp-steadychange) antes de ofrecer el respaldo
const ESPERA_MAPA_MS = 12_000;
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

/** "3 proyectos · 10 lotes" si hay parcelaciones; "1 lote" o "4 lotes" si cada proyecto es un solo lote */
const textoConteo = (proyectos: number, lotes: number) =>
  lotes > proyectos
    ? `${proyectos === 1 ? '1 proyecto' : `${proyectos} proyectos`} · ${lotes} lotes`
    : lotes === 1
      ? '1 lote'
      : `${lotes} lotes`;
const sumaUnidades = (lotes: LoteGlobo[]) => lotes.reduce((s, l) => s + l.unidades, 0);

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
      const deZona = cfg.lotes.filter((l) => l.zona.id === z.id && pasa.has(l.id));
      $(`[data-grupo="${z.id}"]`).hidden = deZona.length === 0;
      $(`[data-grupo="${z.id}"] [data-grupo-n]`).textContent = textoConteo(deZona.length, sumaUnidades(deZona));
    }
    $('[data-conteo]').textContent = textoConteo(pasa.size, sumaUnidades(cfg.lotes.filter((l) => pasa.has(l.id))));
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
  let sinGlobo = false;
  // El mapa dio al menos una señal de vida (quedó estable): desde entonces el respaldo no se dispara solo
  let vivo = false;
  let pararGlobo = () => {};
  const respaldo = () => {
    if (sinGlobo) return;
    sinGlobo = true;
    pararGlobo();
    cerrarFicha();
    delete raiz.dataset.cine;
    $('[data-etapa]').classList.remove('visible');
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
  // Clave rechazada: gm_authFailure avisa en el mapa clásico; en 3D no siempre, por eso abajo hay más señales
  window.gm_authFailure = respaldo;

  try {
    await cargarMaps(cfg.key);
  } catch {
    respaldo();
    return;
  }
  let maps3d: any;
  let PinElement: any;
  try {
    maps3d = await window.google.maps.importLibrary('maps3d');
    ({ PinElement } = await window.google.maps.importLibrary('marker'));
  } catch {
    respaldo();
    return;
  }
  const { Map3DElement, Polygon3DElement, Polyline3DElement, Marker3DElement } = maps3d;
  const MarcadorClic = maps3d.Marker3DInteractiveElement ?? Marker3DElement;

  // Satélite sin etiquetas de Google: solo se nombran los países y regiones donde hay lotes
  const mapa = new Map3DElement({ ...PLANETA, mode: 'SATELLITE' });
  $('[data-lienzo]').append(mapa);
  // En celular la lista y la ficha ocupan la parte baja: se ocultan brújula y pantalla completa (la atribución queda)
  const angosto = matchMedia('(max-width: 767px)');
  // Tablet y celular: un solo panel a la vez y sin órbita automática
  const compacto = matchMedia('(max-width: 1100px)');
  const ajustarUI = () => (mapa.defaultUIHidden = angosto.matches);
  ajustarUI();
  angosto.addEventListener('change', ajustarUI);

  // Vigilante: si Google rechaza la clave, el 3D muestra su recuadro gris de error y nunca llega a estar estable.
  // Un mapa sano tampoco avisa que está estable mientras la cámara se mueve (la llegada gira 22 s) ni mientras la
  // pestaña no dibuja cuadros (segundo plano), así que el reloj solo corre con la página dibujando y la cámara quieta.
  // Mientras el mapa no dé señal de vida, 12 s así pasan al respaldo; después de una sola señal de vida, jamás
  let ultimoMovimiento = performance.now();
  let ultimoCuadro = performance.now();
  let quietoMs = 0;
  const latir = () => {
    ultimoCuadro = performance.now();
    if (!vivo && !sinGlobo) requestAnimationFrame(latir);
  };
  requestAnimationFrame(latir);
  const sondeo = window.setInterval(() => {
    const ahora = performance.now();
    const dibujando = ahora - ultimoCuadro < 1500;
    const quieto = ahora - ultimoMovimiento > 1500;
    quietoMs = dibujando && quieto ? quietoMs + 1000 : 0;
    if (quietoMs >= ESPERA_MAPA_MS) sinSenal();
  }, 1000);
  const darPorVivo = () => {
    vivo = true;
    window.clearInterval(sondeo);
    obsRed?.disconnect();
  };
  const sinSenal = () => {
    if (!vivo) respaldo();
  };
  ['gmp-centerchange', 'gmp-rangechange', 'gmp-tiltchange', 'gmp-headingchange'].forEach((n) =>
    mapa.addEventListener(n, () => (ultimoMovimiento = performance.now())),
  );
  mapa.addEventListener('gmp-steadychange', (e: any) => e.isSteady && darPorVivo());
  // Errores explícitos: evento del propio mapa y respuesta 4xx a la configuración del 3D (clave o referer rechazados)
  mapa.addEventListener('gmp-error', sinSenal);
  window.google.maps.event?.addListener?.(mapa, 'gmp-error', sinSenal);
  const rechazada = (e: PerformanceEntry) => {
    const { name, responseStatus } = e as PerformanceResourceTiming;
    return /MapsJsInternalService\/GetMap3DConfig/.test(name) && responseStatus >= 400 && responseStatus < 500 && responseStatus !== 429;
  };
  let obsRed: PerformanceObserver | undefined;
  try {
    obsRed = new PerformanceObserver((lista) => lista.getEntries().some(rechazada) && sinSenal());
    obsRed.observe({ type: 'resource', buffered: true });
  } catch {
    // Navegador sin PerformanceObserver de recursos: quedan las otras señales
  }
  pararGlobo = () => {
    window.clearInterval(sondeo);
    obsRed?.disconnect();
  };

  // La API renombró outerCoordinates/coordinates a path; se usa lo que exista
  const ruta = (el: any, puntos: object[], viejo: 'outerCoordinates' | 'coordinates') => {
    if ('path' in el) el.path = puntos;
    else el[viejo] = puntos;
  };

  // Capas de contexto: contorno y nombre de cada país, región y municipio con lotes. Cada una aparece solo en su
  // escala (desvanecido por distancia de cámara): el país al acercarse a él, la región al llegar al país, etc.
  type Capa = { lineas: any[]; rgb: string; alfa: number; nombre?: any; ventana: [number, number, number, number]; actual: number };
  const capas: Capa[] = [];
  const leerGeo = async (nombre: string) => (await fetch(`${cfg.capas}${nombre}.geojson`).then((r) => r.json())).features as any[];
  const anillosDe = (f: any): LatLng[][] =>
    f.geometry.coordinates.map((poly: number[][][]) => poly[0].map(([lng, lat]) => ({ lat, lng })));
  const nuevaCapa = (anillos: LatLng[][], rgb: string, alfa: number, ancho: number, ventana: Capa['ventana'], nombre?: any) => {
    const lineas = anillos.map((a) => {
      const el = new Polyline3DElement({ altitudeMode: 'CLAMP_TO_GROUND', strokeColor: `rgba(${rgb},0)`, strokeWidth: ancho, drawsOccludedSegments: true });
      ruta(el, a, 'coordinates');
      return el;
    });
    capas.push({ lineas, rgb, alfa, nombre, ventana, actual: -1 });
    programarCapas();
  };
  // ventana = [aparece desde, opaco desde, opaco hasta, desaparece en] en metros de distancia de cámara
  const nivel = (rango: number, [a, b, c, d]: Capa['ventana']) => {
    const l = (x: number) => Math.log(x);
    if (rango >= a || rango <= d) return 0;
    if (rango > b) return (l(a) - l(rango)) / (l(a) - l(b));
    if (rango < c) return (l(rango) - l(d)) / (l(c) - l(d));
    return 1;
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
  const centroideLotes = centroide(cfg.lotes);
  for (const t of cfg.territorios) {
    leerGeo(t.capa).then((fs) => {
      const anillos = fs.flatMap(anillosDe);
      const mayor = anillos.reduce((a, b) => (b.length > a.length ? b : a));
      const c = centroide(mayor);
      // El país se nombra al sur de su centro para no chocar con el marcador de lotes; la región, al norte de sus lotes
      const lugar = t.tipo === 'pais' ? { ...c, lat: c.lat - 4.5 } : { ...centroideLotes, lat: centroideLotes.lat + 0.5 };
      if (t.tipo === 'pais') nuevaCapa(anillos, '255,255,255', 0.92, 3, [8e6, 4.5e6, 7e5, 3e5], etiqueta(t.nombre, lugar, 'pais'));
      else nuevaCapa(anillos, '255,255,255', 0.8, 2, [1.4e6, 8e5, 7e4, 3e4], etiqueta(t.nombre, lugar, 'region'));
    });
  }
  // Municipios con lotes: contorno dorado y su nombre, solo ya cerca de la región
  const conLotes = new Set(cfg.lotes.map((l) => l.municipio));
  leerGeo('municipios').then((fs) => {
    for (const f of fs) {
      if (!conLotes.has(f.properties.nombre)) continue;
      const anillos = anillosDe(f);
      nuevaCapa(anillos, '183,143,84', 0.9, 2, [1.3e5, 7e4, 5e3, 2e3], etiqueta(f.properties.nombre, centroide(anillos[0]), 'region'));
    }
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

  const etiquetaLote = (l: LoteGlobo) => `${l.nombre} · ${l.precioCorto}`;
  const marcadoresLote = new Map<string, any>();
  for (const l of cfg.lotes) {
    const m = new MarcadorClic({
      position: { lat: l.lat, lng: l.lng, altitude: 40 },
      altitudeMode: 'RELATIVE_TO_GROUND',
      extruded: true,
      sizePreserved: true,
      // Nombre del proyecto y precio en el pin: "Villas de Prado Verde · Desde $110 M"
      label: etiquetaLote(l),
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
      // Sin texto: el municipio ya se nombra con su contorno; el pin muestra el número de lotes
      title: `${sumaUnidades(lotesG)} lotes en ${lotesG[0].municipio}`,
    });
    g.m.addEventListener('gmp-click', () => volar(camaraGrupo(lotesG), 3000));
    g.ids.forEach((id) => enGrupo.set(id, g));
  }

  // Lote abierto: el pin se vuelve una placa oscura con nombre y precio, anclada al lote por una punta
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const placa = (l: LoteGlobo) => {
    const ancho = Math.ceil(Math.max(l.nombre.length * 9.4, l.precioCorto.length * 8.2) + 36);
    const t = document.createElement('template');
    t.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="68" viewBox="0 0 ${ancho} 68">` +
      `<rect x="1" y="1" width="${ancho - 2}" height="54" rx="14" fill="rgba(17,19,20,0.94)" stroke="#b78f54" stroke-width="1.5"/>` +
      `<path d="M${ancho / 2 - 8} 55 L${ancho / 2} 67 L${ancho / 2 + 8} 55 Z" fill="rgba(17,19,20,0.94)" stroke="#b78f54" stroke-width="1.5"/>` +
      `<rect x="${ancho / 2 - 9}" y="52" width="18" height="4" fill="rgba(17,19,20,0.94)"/>` +
      `<text x="18" y="24" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="600" fill="#f4f5f3">${esc(l.nombre)}</text>` +
      `<text x="18" y="44" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="500" fill="#c49e64">${esc(l.precioCorto)}</text>` +
      `</svg>`;
    return t;
  };
  const marcarActivo = () =>
    marcadoresLote.forEach((m, id) => {
      const l = porId.get(id)!;
      const activo = id === abierto;
      m.replaceChildren(activo ? placa(l) : pin(colorLote(l, false)));
      // El lote abierto ya lleva su nombre en la placa: sin etiqueta nativa para no repetirlo
      m.label = activo ? null : etiquetaLote(l);
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
    m.addEventListener('gmp-click', () => explorar());
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
      const visibles = cfg.lotes.filter((l) => l.departamento === region && pasa.has(l.id));
      // El número del pin cuenta lotes (unidades), no proyectos
      const n = sumaUnidades(visibles);
      if (m.dataset.n !== String(n)) {
        m.dataset.n = String(n);
        m.replaceChildren(pin(DORADO, String(n), 1.3));
      }
      mostrar(m, !cerca && visibles.length > 0);
    });
    const juntos = rango > UMBRAL_VECINOS;
    for (const g of grupos) {
      if (!g.m) continue;
      const visibles = g.ids.filter((id) => pasa.has(id));
      const n = sumaUnidades(visibles.map((id) => porId.get(id)!));
      if (g.m.dataset.n !== String(n)) {
        g.m.dataset.n = String(n);
        g.m.replaceChildren(pin(DORADO, String(n), 1.15));
      }
      mostrar(g.m, !dibujando && cerca && juntos && visibles.length > 1 && !g.ids.includes(abierto ?? ''));
    }
    marcadoresLote.forEach((m, id) => {
      const g = enGrupo.get(id);
      const agrupado = g && juntos && g.ids.filter((x) => pasa.has(x)).length > 1 && !g.ids.includes(abierto ?? '');
      mostrar(m, !dibujando && cerca && !agrupado && (pasa.has(id) || id === abierto));
    });
    for (const c of capas) {
      const k = Math.round(nivel(rango, c.ventana) * 20) / 20;
      if (k === c.actual) continue;
      c.actual = k;
      for (const l of c.lineas) {
        l.strokeColor = `rgba(${c.rgb},${(k * c.alfa).toFixed(2)})`;
        mostrar(l, k > 0);
      }
      if (c.nombre) mostrar(c.nombre, k >= 0.6);
    }
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
  const marcarOrbita = (si: boolean) =>
    $$('[data-orbitar]').forEach((b) => {
      b.setAttribute('aria-pressed', String(si));
      $('[data-orbitar-txt]', b).textContent = si ? 'Detener giro' : 'Girar alrededor';
    });
  const detener = () => {
    if (cine) terminarCine(false);
    mapa.stopCameraAnimation?.();
    if (animacion === 'orbita') marcarOrbita(false);
    animacion = 'ninguna';
  };
  const pararVigilante = pararGlobo;
  pararGlobo = () => {
    pararVigilante();
    detener();
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
  // El centro de la cámara se corre para que el lote quede en la parte libre de la pantalla.
  // Celular: la ficha tapa la mitad baja, el centro va hacia quien mira y el lote sube.
  // Tablet: la ficha tapa la derecha, el centro va hacia la derecha de la cámara y el lote pasa a la izquierda
  const camaraLlegada = (l: LoteGlobo): Camara => {
    const cam = camaraLote(l);
    if (!compacto.matches) return cam;
    const h = (cam.heading * Math.PI) / 180;
    const mLat = 110_574;
    const mLng = 111_320 * Math.cos((cam.center.lat * Math.PI) / 180);
    let lat = cam.center.lat;
    let lng = cam.center.lng;
    if (angosto.matches) {
      const k = cam.range * 0.3;
      lat -= (k * Math.cos(h)) / mLat;
      lng -= (k * Math.sin(h)) / mLng;
    } else {
      // Medio ancho de la ficha en píxeles, convertido a metros con el campo de visión vertical (~0,63 veces el rango)
      const alto = Math.max(1, $('[data-lienzo]').clientHeight);
      const k = (cam.range * 0.63 * (ficha.offsetWidth / 2)) / alto;
      lat -= (k * Math.sin(h)) / mLat;
      lng += (k * Math.cos(h)) / mLng;
    }
    return { ...cam, center: { ...cam.center, lat, lng } };
  };
  // Si quien mira detiene el giro, no se reanuda solo mientras siga en ese lote
  let orbitaDetenida = false;
  const orbitar = () => {
    if (!abierto || reducido) return;
    orbitaDetenida = false;
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
  $$('[data-orbitar]').forEach((b) =>
    b.addEventListener('click', () => {
      if (animacion === 'orbita') {
        orbitaDetenida = true;
        detener();
      } else orbitar();
    }),
  );

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
  // Omitir: salta al final del vuelo, muestra los paneles y deja que corra lo de la llegada (órbita en escritorio)
  let finCine: Camara | undefined;
  const omitirCine = () => {
    if (!cine || !finCine) return;
    const fin = finCine;
    cancelAnimationFrame(cine);
    cine = 0;
    animacion = 'ninguna';
    window.clearTimeout(ocultarEtapa);
    Object.assign(mapa, fin);
    mostrarPaneles();
    programarCapas();
    alLlegar();
  };
  $('[data-omitir]').addEventListener('click', omitirCine);
  const vueloCine = (fin: Camara, l: LoteGlobo, llegada: () => void) => {
    detener();
    finCine = fin;
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
    const duracion = Math.min(13_000, Math.max(2_600, razon * 1_150));
    const lista = etapas(l).filter((e) => e.umbral < r0 * 0.8);
    let siguiente = 0;
    const inicio = performance.now();
    animacion = 'cine';
    window.clearTimeout(ocultarEtapa);
    raiz.dataset.cine = '';
    const paso = (ahora: number) => {
      const x = Math.min(1, (ahora - inicio) / duracion);
      // Más lineal que el video: arranca suave pero no se arrastra al llegar
      const p = 0.3 * suave(x) + 0.7 * x;
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
    if (!girando || vista !== 'llegada' || sinGlobo) return;
    const t = Math.min(1, (ahora - giroInicio) / 22_000);
    const suave = 1 - (1 - t) ** 3;
    mapa.center = { lat: PLANETA.center.lat, lng: giroDesde + (giroHasta - giroDesde) * suave, altitude: 0 };
    if (t < 1) requestAnimationFrame(girar);
  };
  mapa.center = { ...PLANETA.center, lng: reducido ? giroHasta : giroDesde };
  requestAnimationFrame(girar);
  $('[data-lienzo]').addEventListener('pointerdown', () => {
    girando = false;
    if (animacion === 'orbita') orbitaDetenida = true;
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
    orbitaDetenida = false;
    zonaActual = l.zona.id;
    ponerVista('lote');
    ponerMiga(l.zona.id);
    abrirFicha(id);
    hash(id);
    vueloCine(camaraLlegada(l), l, () => {
      // Al llegar, la cámara empieza a girar despacio alrededor del lindero
      // Órbita automática solo en escritorio (el dueño la pidió); en tablet y celular queda a pedido con "Girar alrededor"
      if (vista === 'lote' && abierto === id && !dibujando && !compacto.matches && !orbitaDetenida) orbitar();
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

  // Explorar lleva directo a los lotes de Guarne (zona de entrada del demo); si no hay, a Antioquia
  const zonaEntrada = cfg.lotes.find((l) => l.municipio === MUNICIPIO_ENTRADA)?.zona.id;
  const explorar = () => (zonaEntrada ? irZona(zonaEntrada, 6000) : irAntioquia());
  $('[data-explorar]').addEventListener('click', explorar);
  $('[data-ir-antioquia]').addEventListener('click', () => irAntioquia(2500));
  $$('[data-ir-zona]').forEach((b) => b.addEventListener('click', () => irZona(b.dataset.irZona!)));
  $$('[data-abrir]').forEach((b) => b.addEventListener('click', () => irLote(b.dataset.abrir!)));
  $$('[data-volver]').forEach((b) => b.addEventListener('click', volverAlMapa));
  // Tablet: "Lista" cierra la ficha y devuelve la lista (un solo panel a la vez)
  $('[data-lista-btn]').addEventListener('click', volverAlMapa);
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
