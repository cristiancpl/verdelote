import { LngLat, LngLatBounds, Map as Mapa, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// @ts-ignore: sufijo de Vite; empaqueta el worker de MapLibre 6 junto con su módulo compartido
import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { destinos, distancia, lados, miles, type CamaraDron, type Destino, type Punto } from '../data/destinos';

setWorkerUrl(urlWorker);

// espacio: globo y lista de lotes · vuelo: descenso · lote: toma de dron
// lindero: vista cenital con medidas · satelite: lote sin vuelo de dron todavía
type Etapa = 'espacio' | 'vuelo' | 'lote' | 'lindero' | 'satelite';
type Camara = { center: Punto; zoom: number; bearing: number; pitch: number };
/** Cámara del dron en metros locales: posición, altura, rumbo e inclinación desde la vertical. */
type Pose = { e: number; n: number; h: number; rumbo: number; incl: number };

const TESELAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const RADIO = 6371008.8;
const FOV_MAPA = 36.87;
const calmado = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Tiempos en ms. zambullida: de la vista lejana al video · salida: del video al lindero
// regreso: del lindero al video · despegue: del video a la vista lejana antes de volver al planeta
const T = { vuelo: 8600, pausa: 350, zambullida: 3000, salida: 2800, regreso: 3000, despegue: 1300 };
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

const cuerpo = document.body;
const uno = <E extends HTMLElement>(s: string) => document.querySelector<E>(s)!;
const lienzoMapa = uno('#mapa');
const dron = uno<HTMLVideoElement>('#dron');
const hudLugar = uno('#hud-lugar');
const hudAltitud = uno('#hud-altitud');
const acerca = uno<HTMLDialogElement>('#acerca');
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rad = (g: number) => (g * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
// Misma condición que la hoja de estilos: en pantalla ancha el texto va a la izquierda y el globo
// a la derecha; en el celular en vertical el globo va arriba y el texto abajo.
const ANCHA = matchMedia('(min-width: 821px), (min-width: 560px) and (min-aspect-ratio: 4/3)');
const pantallaAncha = () => ANCHA.matches;
/** Escalón suave entre a y b. */
const suave = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Arranca y frena sin tirones. */
const entraSale = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

let destino: Destino = destinos.find((d) => d.id === location.hash.slice(1)) ?? destinos[0];
let etapa: Etapa = 'espacio';
let saltar: (() => void) | null = null;
/** Queda en true al llegar a un lote: falta el paso automático y temprano al lindero. */
let linderoPendiente = false;
/** Cada recorrido nuevo sube este contador; las animaciones en curso lo comparan y se detienen. */
let viaje = 0;

function ponerEtapa(nueva: Etapa) {
  etapa = nueva;
  cuerpo.dataset.etapa = nueva;
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
    const visible = panel.dataset.panel === nueva && (!panel.dataset.de || panel.dataset.de === destino.id);
    panel.classList.toggle('visible', visible);
    panel.inert = !visible;
  });
}

// ---------------------------------------------------------------------------------------------
// Cámara del dron
// ---------------------------------------------------------------------------------------------

const poli = (c: number[], k: number) => c[0] + c[1] * k + (c[2] ?? 0) * k * k;

/** Dónde estaba y hacia dónde miraba el dron en el segundo t del video. */
function poseDron(c: CamaraDron, t: number): Pose {
  const k = (t - c.medio) / c.medio;
  return { e: poli(c.este, k), n: poli(c.norte, k), h: poli(c.altura, k), rumbo: poli(c.rumbo, k), incl: poli(c.inclinacion, k) };
}

const aGeo = (c: CamaraDron, e: number, n: number): Punto => [c.origen[0] + deg(e / (RADIO * Math.cos(rad(c.origen[1])))), c.origen[1] + deg(n / RADIO)];

/**
 * Campo visual vertical que debe tener el mapa para ver lo mismo que el video en esta pantalla.
 * El video llena la pantalla recortándose: si la pantalla es más ancha que el video, se pierde alto.
 */
function fovVista(c: CamaraDron) {
  const proporcion = lienzoMapa.clientWidth / lienzoMapa.clientHeight;
  return proporcion <= c.aspecto ? c.fov : deg(2 * Math.atan((Math.tan(rad(c.fov) / 2) * c.aspecto) / proporcion));
}
const fovPara = (d: Destino) => (d.video ? fovVista(d.video.camara) : FOV_MAPA);

/** Cámara del mapa que reproduce el punto de vista del dron. */
function camaraDeDron(c: CamaraDron, p: Pose): Camara {
  const alcance = p.h * Math.tan(rad(p.incl)); // del pie de la cámara al punto que mira
  const center = aGeo(c, p.e + alcance * Math.sin(rad(p.rumbo)), p.n + alcance * Math.cos(rad(p.rumbo)));
  const metros = p.h / Math.cos(rad(p.incl)); // de la cámara a ese punto
  const pixeles = lienzoMapa.clientHeight / 2 / Math.tan(rad(fovVista(c)) / 2);
  const zoom = Math.log2((40075016.686 * Math.cos(rad(center[1]))) / ((512 * metros) / pixeles));
  return { center, zoom, bearing: p.rumbo, pitch: p.incl };
}

/** Punto del terreno que ve el dron en la posición (u, v) del cuadro; u y v van de 0 a 1. */
function alSuelo(c: CamaraDron, p: Pose, u: number, v: number): Punto {
  const y = rad(p.rumbo), q = rad(p.incl), f = 0.5 / Math.tan(rad(c.fov) / 2);
  const x = (u - 0.5) * c.aspecto, z = v - 0.5; // en alturas de cuadro
  // rayo = adelante · f + derecha · x − arriba · z
  const rE = Math.sin(q) * Math.sin(y) * f + Math.cos(y) * x - Math.cos(q) * Math.sin(y) * z;
  const rN = Math.sin(q) * Math.cos(y) * f - Math.sin(y) * x - Math.cos(q) * Math.cos(y) * z;
  const rU = -Math.cos(q) * f - Math.sin(q) * z;
  const s = p.h / -rU;
  return aGeo(c, p.e + rE * s, p.n + rN * s);
}

/** Posición en pantalla del punto (u, v) del video cuando llena la pantalla sin transformar. */
function enElemento(c: CamaraDron, u: number, v: number): [number, number] {
  const W = lienzoMapa.clientWidth, H = lienzoMapa.clientHeight;
  const ancho = W / H > c.aspecto ? W : H * c.aspecto, alto = ancho / c.aspecto;
  return [W / 2 + (u - 0.5) * ancho, H / 2 + (v - 0.5) * alto];
}

/** Transformación proyectiva que lleva cuatro puntos a otros cuatro: [a, b, c, d, e, f, g, h]. */
function homografia(de: [number, number][], a: [number, number][]): number[] | null {
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = de[i], [X, Y] = a[i];
    m.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X], [0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let f = col + 1; f < 8; f++) if (Math.abs(m[f][col]) > Math.abs(m[piv][col])) piv = f;
    if (Math.abs(m[piv][col]) < 1e-10) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let f = 0; f < 8; f++) {
      if (f === col) continue;
      const k = m[f][col] / m[col][col];
      for (let j = col; j < 9; j++) m[f][j] -= k * m[col][j];
    }
  }
  return m.map((fila, i) => fila[8] / fila[i]);
}

// ---------------------------------------------------------------------------------------------
// Globo
// ---------------------------------------------------------------------------------------------

const SIN_MARGEN = { top: 0, bottom: 0, left: 0, right: 0 };
// Tamaño del globo en pantalla. La cámara está cerca, así que el borde que se ve (el limbo) queda
// por dentro del radio real de la esfera; estas dos funciones pasan de uno a otro.
const focal = (fov: number) => lienzoMapa.clientHeight / 2 / Math.tan(rad(fov) / 2);
/** Zoom con el que el globo se ve de "diametro" pixeles, centrado en la latitud dada. */
function zoomGlobo(diametro: number, lat: number, fov: number) {
  const f = focal(fov), s = Math.sin(Math.atan(diametro / 2 / f));
  return Math.log2(((f * s) / (1 - s)) * 2 * Math.PI * Math.cos(rad(lat)) / 512);
}
/** Radio con el que se ve el globo, en pixeles, para un zoom y una latitud de centro. */
function radioGlobo(zoom: number, lat: number, fov: number) {
  const f = focal(fov), radio = (512 * 2 ** zoom) / (2 * Math.PI * Math.cos(rad(lat)));
  return f * Math.tan(Math.asin(radio / (radio + f)));
}
/** Vista del planeta: el globo llena el espacio que deja libre el texto, sin quedar debajo de él. */
function vistaPlaneta(d: Destino) {
  const W = innerWidth, H = innerHeight;
  const texto = uno('[data-panel="espacio"]').getBoundingClientRect();
  let padding = SIN_MARGEN, diametro: number;
  if (pantallaAncha()) {
    const izquierda = Math.min(texto.right + W * 0.03, W * 0.56);
    padding = { ...SIN_MARGEN, left: izquierda };
    diametro = Math.min(H * 0.82, (W - izquierda) * 0.9);
  } else {
    const arriba = 50, abajo = Math.max(0, H - texto.top) + 4;
    padding = { ...SIN_MARGEN, top: arriba, bottom: abajo };
    diametro = Math.min(W * 0.98, H - arriba - abajo);
  }
  const center: Punto = [d.centro[0], d.centro[1] * 0.55];
  return { center, zoom: zoomGlobo(Math.max(150, diametro), center[1], fovPara(d)), pitch: 0, bearing: 0, padding };
}
const vistaLejana = (d: Destino): Camara => ({ center: d.centro, ...d.llegada });

const poligono = (d: Destino) => ({
  type: 'FeatureCollection' as const,
  features: d.lindero
    ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[...d.lindero, d.lindero[0]]] } }]
    : [],
});

const OPACIDAD_LINDERO = ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1];
const conOrtofoto = destinos.filter((d) => d.ortofoto);

let mapa: Mapa | null = null;
try {
  const inicio = vistaPlaneta(destino);
  mapa = new Mapa({
    container: 'mapa',
    ...inicio,
    center: [destino.centro[0] - 55, inicio.center[1]],
    maxPitch: 75, // la toma de dron mira casi hacia el horizonte
    attributionControl: false, // sin créditos en pantalla; las fuentes quedan anotadas en destinos.ts
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        satelite: { type: 'raster', tiles: [`${TESELAS}/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' },
        ...Object.fromEntries(conOrtofoto.map((d) => [`orto-${d.id}`, {
          type: 'raster', tiles: [d.ortofoto!.teselas], tileSize: 256, minzoom: 12, maxzoom: d.ortofoto!.zoomMax, bounds: d.ortofoto!.limites, attribution: d.ortofoto!.atribucion,
        }])),
        lindero: { type: 'geojson', data: poligono(destino) },
      },
      layers: [
        { id: 'satelite', type: 'raster', source: 'satelite' },
        // Fotografía aérea de detalle: aparece al acercarse y reemplaza al satélite alrededor del lote.
        ...conOrtofoto.map((d) => ({
          id: `orto-${d.id}`, type: 'raster', source: `orto-${d.id}`, minzoom: 12.5,
          paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.4, 1], 'raster-fade-duration': 150 },
        })),
        {
          id: 'lindero-relleno', type: 'fill', source: 'lindero',
          paint: { 'fill-color': '#f3d48a', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 16.4, 0, 17.2, 0.14] },
        },
        {
          id: 'lindero-linea', type: 'line', source: 'lindero',
          layout: { 'line-join': 'round' },
          paint: { 'line-color': '#f3d48a', 'line-width': 3, 'line-opacity': OPACIDAD_LINDERO, 'line-opacity-transition': { duration: 700, delay: 0 } },
        },
      ],
      // Con la cámara muy inclinada queda una franja de cielo sobre el horizonte. Va en un tono medio,
      // como tierra lejana con bruma: en blanco se veía como un velo al acercarse.
      sky: {
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
        'sky-color': '#7d8c8f', 'horizon-color': '#7f8f7c', 'fog-color': '#7f8f7c', 'sky-horizon-blend': 0.5,
      },
    } as any,
  });
} catch {
  mapa = null; // Sin WebGL: el recorrido pasa directo al video.
  cuerpo.dataset.sinMapa = '';
}

if (mapa) {
  // El planeta gira hasta mostrar el lote elegido, sin esperar a que cargue toda la imagen.
  mapa.setVerticalFieldOfView(fovPara(destino));
  mapa.setPadding(vistaPlaneta(destino).padding);
  mapa.easeTo({ ...vistaPlaneta(destino), duration: calmado ? 0 : 6500, easing: (t) => 1 - (1 - t) ** 3 });
  mapa.once('load', () => precargar(destino));
  mapa.on('move', () => { actualizarHud(); actualizarHalo(); });

  destinos.forEach((d) => {
    // Punto del lote sobre el globo: al tocarlo se baja directo.
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    pin.dataset.pin = d.id;
    pin.setAttribute('aria-label', `Bajar a ${d.nombre}`);
    pin.innerHTML = `<span>${d.nombre}</span>`;
    pin.addEventListener('click', () => { elegir(d, false); bajar(); });
    new Marker({ element: pin }).setLngLat(d.centro).addTo(mapa!);

    if (d.estado === 'satelite') {
      const zona = document.createElement('div');
      zona.className = 'zona';
      new Marker({ element: zona }).setLngLat(d.centro).addTo(mapa!);
    }
    (d.lindero ? lados(d.lindero) : []).forEach((lado) => {
      const medida = document.createElement('span');
      medida.className = 'medida';
      medida.innerHTML = `<i>${Math.round(lado.metros)} m</i>`;
      new Marker({ element: medida }).setLngLat([(lado.desde[0] + lado.hasta[0]) / 2, (lado.desde[1] + lado.hasta[1]) / 2]).addTo(mapa!);
    });
  });
}

// Deja en caché las teselas de la llegada para que el final del vuelo se vea nítido.
function precargar(d: Destino) {
  const [lng, lat] = d.centro;
  const tesela = (z: number) => {
    const n = 2 ** z;
    return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * n)];
  };
  for (let z = 10; z <= Math.ceil(d.llegada.zoom) + 1; z++) {
    const [x, y] = tesela(z);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 1; dy++) fetch(`${TESELAS}/${z}/${y + dy}/${x + dx}`).catch(() => {});
  }
  if (!d.ortofoto) return;
  for (let z = 14; z <= Math.min(18, d.ortofoto.zoomMax); z++) {
    const [x, y] = tesela(z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      fetch(d.ortofoto.teselas.replace('{z}', String(z)).replace('{x}', String(x + dx)).replace('{y}', String(y + dy))).catch(() => {});
    }
  }
}

// --- Relato del descenso: por dónde va y a qué altura ---
function altitudTexto(metros: number) {
  if (metros >= 1e6) return `${miles(Math.round(metros / 1e5) * 100)} km`;
  if (metros >= 1e4) return `${miles(Math.round(metros / 1e3))} km`;
  if (metros >= 1e3) return `${(metros / 1e3).toLocaleString('es-CO', { maximumFractionDigits: 1 })} km`;
  return `${miles(Math.round(metros / 10) * 10)} m`;
}

function actualizarHud() {
  if (!mapa || etapa !== 'vuelo' || cuerpo.classList.contains('zambullida')) return;
  const zoom = mapa.getZoom();
  const centro = mapa.getCenter();
  // Una escala solo cuenta cuando la cámara ya está sobre ella (importa al volar de un lote a otro).
  const cerca = distancia([centro.lng, centro.lat], destino.centro) < 6e6 / 2 ** Math.max(0, zoom - 3);
  const nombre = (cerca ? destino.escalas.find((e) => zoom < e.hasta) : destino.escalas[0])!.nombre;
  if (hudLugar.textContent !== nombre) {
    hudLugar.textContent = nombre;
    hudLugar.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: 'ease-out' });
  }
  const metrosPorPixel = (78271.517 * Math.cos(rad(centro.lat))) / 2 ** zoom;
  const pixelesAlCentro = lienzoMapa.clientHeight / 2 / Math.tan(rad(mapa.getVerticalFieldOfView()) / 2);
  hudAltitud.textContent = altitudTexto(pixelesAlCentro * metrosPorPixel * Math.cos(rad(mapa.getPitch())));
}

// Resplandor alrededor del planeta: sigue al globo cuando se gira o se acerca con los dedos.
const halo = uno('#halo');
function actualizarHalo() {
  if (!mapa || etapa !== 'espacio') return;
  const centro = mapa.project(mapa.getCenter());
  halo.style.setProperty('--gx', `${centro.x.toFixed(1)}px`);
  halo.style.setProperty('--gy', `${centro.y.toFixed(1)}px`);
  halo.style.setProperty('--gr', `${radioGlobo(mapa.getZoom(), mapa.getCenter().lat, mapa.getVerticalFieldOfView()).toFixed(1)}px`);
}

/**
 * Qué versión de la toma cargar. Celular y computador reciben la de 1080p; si la persona pidió
 * ahorrar datos, va la liviana.
 */
function archivoDeVideo(v: NonNullable<Destino['video']>) {
  // Solo cuando la persona activó el ahorro de datos. La velocidad que estima el navegador del
  // celular suele quedar baja aunque la red sea buena, y mandaba la versión de 720p sin necesidad.
  const red = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return red?.saveData ? v.archivoLiviano ?? v.archivo : v.archivo;
}

// --- Elegir lote ---
function elegir(d: Destino, mover = true) {
  destino = d;
  cuerpo.dataset.destino = d.id;
  history.replaceState(null, '', `#${d.id}`);
  document.querySelectorAll<HTMLElement>('[data-elegir]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.elegir === d.id)));
  document.querySelectorAll<HTMLElement>('[data-pin]').forEach((p) => p.classList.toggle('elegido', p.dataset.pin === d.id));
  (mapa?.getSource('lindero') as GeoJSONSource | undefined)?.setData(poligono(d));
  const src = d.video ? `${base}/${archivoDeVideo(d.video)}` : '';
  if (src && dron.getAttribute('src') !== src) dron.src = src;
  if (mapa?.loaded()) precargar(d);
  if (etapa === 'espacio') mapa?.setVerticalFieldOfView(fovPara(d));
  if (mover && etapa === 'espacio') mapa?.easeTo({ ...vistaPlaneta(d), duration: calmado ? 0 : 1800 });
}

// ---------------------------------------------------------------------------------------------
// Entre el mapa y la toma de dron
//
// No es un fundido entre dos imágenes: es un solo movimiento de cámara. El mapa se pone en el punto
// de vista del dron y, mientras llega o se aleja, el video va "pegado" al terreno en perspectiva,
// como una foto extendida sobre el suelo. Cuando las dos cámaras coinciden, el video llena la
// pantalla sin ningún salto.
// ---------------------------------------------------------------------------------------------

const camaraActual = (): Camara => {
  const c = mapa!.getCenter();
  return { center: [c.lng, c.lat], zoom: mapa!.getZoom(), bearing: mapa!.getBearing(), pitch: mapa!.getPitch() };
};
const ponerCamara = (c: Camara) => mapa!.jumpTo({ ...c, padding: SIN_MARGEN });

/** Punto intermedio entre dos cámaras; el rumbo gira por el lado corto. */
function mezclar(a: Camara, b: Camara, w: number): Camara {
  const giro = ((b.bearing - a.bearing + 540) % 360) - 180;
  return {
    center: [a.center[0] + (b.center[0] - a.center[0]) * w, a.center[1] + (b.center[1] - a.center[1]) * w],
    zoom: a.zoom + (b.zoom - a.zoom) * w,
    bearing: a.bearing + giro * w,
    pitch: a.pitch + (b.pitch - a.pitch) * w,
  };
}

// Cuatro puntos del cuadro que siempre caen en terreno cercano (lejos del horizonte).
const REFERENCIAS: [number, number][] = [[0.2, 0.42], [0.8, 0.42], [0.8, 0.93], [0.2, 0.93]];

/** Deforma el video para que el cuadro del segundo t quede sobre el terreno que muestra, visto desde el mapa. */
function pegarVideo(t: number) {
  const c = destino.video!.camara, p = poseDron(c, t);
  const de = REFERENCIAS.map(([u, v]) => enElemento(c, u, v));
  const a = REFERENCIAS.map(([u, v]) => { const q = mapa!.project(alSuelo(c, p, u, v)); return [q.x, q.y] as [number, number]; });
  const h = homografia(de, a);
  dron.style.transform = h ? `matrix3d(${h[0]},${h[3]},0,${h[6]},${h[1]},${h[4]},0,${h[7]},0,0,1,0,${h[2]},${h[5]},0,1)` : 'none';
}

/**
 * Aspecto de las dos capas según qué tan cerca está la cámara del mapa de la del dron (0 lejos, 1 encima).
 * De lejos manda el mapa, nítido. Al acercarse, el video aparece primero sobre el lote y se abre hacia
 * los bordes mientras el mapa de alrededor se desenfoca y toma la luz de la toma.
 */
function pintarCapas(cercania: number) {
  const apertura = suave(0.25, 0.97, cercania) ** 1.3;
  dron.style.opacity = String(suave(0.3, 0.8, cercania));
  if (apertura >= 0.999) dron.classList.remove('recortado');
  else {
    const borde = 34 + 116 * apertura;
    dron.classList.add('recortado');
    dron.style.setProperty('--m0', `${Math.max(0, borde - 30)}%`);
    dron.style.setProperty('--m1', `${borde}%`);
    // El difuminado de los bordes del cuadro se cierra justo al llenar la pantalla.
    dron.style.setProperty('--b', `${(13 * (1 - suave(0.93, 1, cercania))).toFixed(2)}%`);
  }
  // El mapa de alrededor se desenfoca y se oscurece (no se aclara: eso se veía como un velo blanco).
  const foco = suave(0.35, 0.9, cercania);
  lienzoMapa.style.filter = foco < 0.002 ? '' : `blur(${((pantallaAncha() ? 5 : 3.5) * foco).toFixed(2)}px) brightness(${(1 - 0.45 * foco).toFixed(3)}) saturate(${(1 + 0.08 * foco).toFixed(3)})`;
}

/** Deja las capas en reposo: video a pantalla completa o mapa solo. */
function reposo(conVideo: boolean) {
  dron.style.transform = 'none';
  dron.classList.remove('recortado');
  dron.style.opacity = conVideo ? '1' : '0';
  lienzoMapa.style.filter = '';
  cuerpo.dataset.video = conVideo ? 'si' : 'no';
}

/** Un cuadro de la entrada: la cámara va de "desde" a la del dron en el segundo t del video. */
function cuadroEntrada(p: number, desde: Camara, t: number) {
  const c = destino.video!.camara, w = entraSale(p);
  ponerCamara(mezclar(desde, camaraDeDron(c, poseDron(c, t)), w));
  pegarVideo(t);
  pintarCapas(w);
}

/** Un cuadro de la salida: la cámara deja la trayectoria del dron (tCamara) y va hacia "hacia". */
function cuadroSalida(p: number, hacia: Camara, tCamara: number, tCuadro: number) {
  const c = destino.video!.camara, w = entraSale(p);
  ponerCamara(mezclar(camaraDeDron(c, poseDron(c, tCamara)), hacia, w));
  pegarVideo(tCuadro);
  pintarCapas(1 - w);
}

/** Corre "paso" en cada cuadro durante ms; devuelve false si otro recorrido la interrumpió. */
function animar(ms: number, paso: (p: number, dt: number) => void, mio: number): Promise<boolean> {
  return new Promise((listo) => {
    const t0 = performance.now();
    let antes = t0;
    const cuadro = (ahora: number) => {
      if (mio !== viaje) return listo(false);
      const p = ms <= 0 ? 1 : Math.min(1, (ahora - t0) / ms);
      paso(p, (ahora - antes) / 1000);
      antes = ahora;
      if (p < 1) requestAnimationFrame(cuadro); else listo(true);
    };
    requestAnimationFrame(cuadro);
  });
}

// Reloj del video sin los escalones de 30 cuadros por segundo de currentTime.
let relojVideo = 0, relojMarca = 0;
dron.addEventListener('playing', () => { relojVideo = dron.currentTime; relojMarca = performance.now(); });
function tiempoVideo() {
  if (dron.paused || dron.ended) return dron.currentTime;
  const ahora = performance.now();
  relojVideo += (ahora - relojMarca) / 1000;
  relojMarca = ahora;
  if (Math.abs(relojVideo - dron.currentTime) > 0.09) relojVideo = dron.currentTime;
  return relojVideo;
}

const videoListo = () =>
  dron.readyState >= 3 ? Promise.resolve() : new Promise<void>((r) => dron.addEventListener('canplay', () => r(), { once: true }));
const lineaLindero = (visible: boolean) => { if (mapa?.getLayer('lindero-linea')) mapa.setPaintProperty('lindero-linea', 'line-opacity', visible ? OPACIDAD_LINDERO : 0); };
const fundido = (elemento: HTMLElement, de: number, a: number, ms: number) => elemento.animate([{ opacity: de }, { opacity: a }], { duration: ms, easing: 'ease-in-out' }).finished.catch(() => {});

/** Entra al video desde una vista del mapa. El video ya corre mientras la cámara llega. */
async function entrarAlVideo(desde: Camara, ms: number, mio: number) {
  cuerpo.classList.add('zambullida');
  lineaLindero(false);
  await dron.play().catch(() => {});
  if (mapa && !calmado) {
    cuerpo.dataset.video = 'entrando';
    if (!(await animar(ms, (p) => cuadroEntrada(p, desde, tiempoVideo()), mio))) return;
  } else {
    dron.style.opacity = '1';
    await fundido(dron, 0, 1, 700);
    if (mio !== viaje) return;
  }
  reposo(true);
  ponerEtapa('lote');
  cuerpo.classList.remove('zambullida');
}

/** Sale del video hacia una vista del mapa. El video sigue corriendo mientras se desvanece. */
async function salirDelVideo(hacia: Camara, ms: number, mio: number): Promise<boolean> {
  if (!mapa || calmado) {
    if (mapa) ponerCamara(hacia);
    await fundido(dron, 1, 0, 600);
    if (mio !== viaje) return false;
  } else {
    // El dron "sigue volando" aunque el video se acabe: la cámara no se frena en seco.
    let tDron = tiempoVideo();
    mapa.setVerticalFieldOfView(fovPara(destino));
    cuerpo.dataset.video = 'saliendo';
    const completo = await animar(ms, (p, dt) => {
      const corriendo = !dron.paused && !dron.ended;
      tDron = corriendo ? tiempoVideo() : tDron + dt;
      cuadroSalida(p, hacia, tDron, corriendo ? tDron : dron.currentTime);
    }, mio);
    if (!completo) return false;
  }
  dron.pause();
  reposo(false);
  return true;
}

/** Margen del mapa para que lo importante quede fuera de la tarjeta: a su derecha o encima de ella. */
function margenDeTarjeta(panel: string, d: Destino) {
  const caja = document.querySelector<HTMLElement>(`[data-panel="${panel}"][data-de="${d.id}"]`)?.getBoundingClientRect();
  if (!caja) return SIN_MARGEN;
  return pantallaAncha() ? { ...SIN_MARGEN, left: caja.right } : { ...SIN_MARGEN, bottom: innerHeight - caja.top };
}

// --- Descenso ---
async function bajar() {
  if (etapa !== 'espacio' && etapa !== 'satelite') return;
  const d = destino;
  const mio = ++viaje;
  ponerEtapa('vuelo');
  cuerpo.classList.remove('zambullida');
  reposo(false);
  if (d.video && dron.readyState < 3) { dron.preload = 'auto'; dron.load(); }

  const lejos = vistaLejana(d);
  // Sin toma de dron el recorrido termina en el mapa: el lote se encuadra en el espacio que deja
  // libre su tarjeta. Con toma de dron llega centrado, porque de ahí sigue la entrada al video.
  const margen = d.video ? SIN_MARGEN : margenDeTarjeta('satelite', d);
  mapa?.stop();
  mapa?.setVerticalFieldOfView(fovPara(d));
  lineaLindero(true);
  if (mapa && !calmado) mapa.flyTo({ ...lejos, padding: margen, duration: T.vuelo, curve: 1.5, essential: true });
  else mapa?.jumpTo({ ...lejos, padding: margen });
  actualizarHud();

  const salto = new Promise<boolean>((r) => { saltar = () => r(true); });
  const saltado = await Promise.race([espera(calmado ? 500 : T.vuelo + T.pausa).then(() => false), salto]);
  saltar = null;
  if (mio !== viaje) return;
  if (saltado) { mapa?.stop(); mapa?.jumpTo({ ...lejos, padding: margen }); }

  if (!d.video) { ponerEtapa('satelite'); return; }

  await videoListo();
  if (mio !== viaje) return;
  dron.currentTime = 0;
  linderoPendiente = true;
  await entrarAlVideo(lejos, saltado ? 1700 : T.zambullida, mio);
}

// --- Lindero y medidas: del video a la vista desde arriba ---
function vistaLindero(rumboActual: number): Camara {
  const lindero = destino.lindero!;
  const masLargo = lados(lindero).reduce((a, b) => (b.metros > a.metros ? b : a));
  const rumbo = deg(Math.atan2((masLargo.hasta[0] - masLargo.desde[0]) * Math.cos(rad(masLargo.desde[1])), masLargo.hasta[1] - masLargo.desde[1]));
  // En pantalla ancha el lado largo queda horizontal; en el celular, vertical. De las dos
  // orientaciones posibles se elige la que menos hace girar la cámara.
  const opciones = pantallaAncha() ? [rumbo - 90, rumbo + 90] : [rumbo, rumbo + 180];
  const giro = (b: number) => Math.abs(((b - rumboActual + 540) % 360) - 180);
  const bearing = opciones.reduce((a, b) => (giro(b) < giro(a) ? b : a));
  // El lote se encuadra en el espacio que deja libre la tarjeta de medidas.
  const tarjeta = document.querySelector<HTMLElement>(`[data-panel="lindero"][data-de="${destino.id}"]`)?.getBoundingClientRect();
  const padding = pantallaAncha()
    ? { top: 96, bottom: 72, left: (tarjeta?.right ?? 440) + 44, right: 64 }
    : { top: 104, bottom: (tarjeta ? innerHeight - tarjeta.top : innerHeight * 0.45) + 30, left: 40, right: 40 };
  const limites = lindero.reduce((b, p) => b.extend(p), new LngLatBounds());
  const cam = mapa!.cameraForBounds(limites, { bearing, padding, maxZoom: 18.6 })!;
  const centro = LngLat.convert(cam.center!);
  return { center: [centro.lng, centro.lat], zoom: cam.zoom!, bearing, pitch: 0 };
}

async function verLindero() {
  if (etapa !== 'lote' || cuerpo.dataset.video !== 'si' || !mapa || !destino.lindero || !destino.video) return;
  linderoPendiente = false;
  const mio = ++viaje;
  const c = destino.video.camara;
  // El mapa se coloca bajo el video en el punto de vista del dron antes de empezar a moverse.
  mapa.setVerticalFieldOfView(fovPara(destino));
  ponerCamara(camaraDeDron(c, poseDron(c, tiempoVideo())));
  const hacia = vistaLindero(mapa.getBearing());
  ponerEtapa('lindero');
  lineaLindero(true);
  await salirDelVideo(hacia, T.salida, mio);
}

async function volverAlVideo() {
  if (etapa !== 'lindero' || !destino.video) return;
  const mio = ++viaje;
  // Si la toma estaba por acabarse, se retoma desde el principio.
  if (dron.ended || dron.duration - dron.currentTime < 5) dron.currentTime = 0;
  ponerEtapa('vuelo');
  cuerpo.classList.add('zambullida');
  await videoListo();
  if (mio !== viaje) return;
  await entrarAlVideo(mapa ? camaraActual() : vistaLejana(destino), T.regreso, mio);
}

async function volverAlPlaneta() {
  if (etapa === 'espacio' || etapa === 'vuelo') return;
  const d = destino;
  const mio = ++viaje;
  const desdeVideo = etapa === 'lote' && cuerpo.dataset.video === 'si' && !!d.video;
  ponerEtapa('espacio');
  if (desdeVideo) {
    if (!(await salirDelVideo(vistaLejana(d), T.despegue, mio))) return;
  } else {
    dron.pause();
    reposo(false);
  }
  lineaLindero(true);
  mapa?.flyTo({ ...vistaPlaneta(d), duration: calmado ? 0 : 3200, essential: true });
}

function compartir() {
  const url = `${location.origin}${location.pathname}#${destino.id}`;
  const texto = `${destino.nombre}, ${destino.lugar}. Baja desde el espacio hasta el lote:`;
  if (navigator.share) navigator.share({ title: destino.nombre, text: texto, url }).catch(() => {});
  else window.open(`https://wa.me/?text=${encodeURIComponent(`${texto} ${url}`)}`, '_blank', 'noopener');
}

const acciones: Record<string, () => void> = {
  bajar,
  saltar: () => saltar?.(),
  lindero: verLindero,
  video: volverAlVideo,
  // Quien pide repetir la toma la quiere ver entera: ya no se corta para ir al lindero.
  repetir: () => { linderoPendiente = false; dron.currentTime = 0; dron.play().catch(() => {}); },
  planeta: volverAlPlaneta,
  compartir,
  demo: () => { elegir(destinos[0], false); bajar(); },
  acerca: () => acerca.showModal(),
};

document.addEventListener('click', (evento) => {
  const origen = (evento.target as HTMLElement).closest<HTMLElement>('[data-accion], [data-elegir]');
  if (!origen) return;
  if (origen.dataset.elegir) elegir(destinos.find((d) => d.id === origen.dataset.elegir)!);
  else acciones[origen.dataset.accion!]?.();
});
// Un enlace compartido a otro lote cambia la selección sin recargar.
addEventListener('hashchange', () => {
  const d = destinos.find((x) => x.id === location.hash.slice(1));
  if (d && d !== destino && etapa === 'espacio') elegir(d);
});
// Al girar el teléfono o cambiar el tamaño de la ventana, el globo se vuelve a acomodar.
let reacomodo = 0;
addEventListener('resize', () => {
  if (etapa !== 'vuelo') mapa?.setVerticalFieldOfView(fovPara(destino));
  clearTimeout(reacomodo);
  reacomodo = window.setTimeout(() => { if (etapa === 'espacio') mapa?.easeTo({ ...vistaPlaneta(destino), duration: calmado ? 0 : 500 }); }, 180);
});
document.addEventListener('keydown', (evento) => { if (evento.key === 'Escape' && etapa === 'vuelo') saltar?.(); });
acerca.addEventListener('click', (evento) => { if (evento.target === acerca) acerca.close(); });

// Poco antes de acabarse la toma, el recorrido sigue solo hacia el lindero: el video se
// desvanece todavía en movimiento, sin llegar a congelarse en su último cuadro.
// La primera vez que se llega a un lote no espera tanto: a los pocos segundos (video.linderoA)
// pasa al lindero y las medidas, que es lo que el comprador vino a ver. Desde ahí se puede volver
// al video, que entonces sí corre hasta el final.
const seguirAlLindero = () => {
  if (etapa !== 'lote' || cuerpo.dataset.video !== 'si') return;
  const corte = destino.video?.linderoA;
  const temprano = linderoPendiente && corte != null && dron.currentTime >= corte;
  if (temprano || dron.duration - dron.currentTime < 2.6) verLindero();
};
dron.addEventListener('timeupdate', seguirAlLindero);
dron.addEventListener('ended', seguirAlLindero);

elegir(destino, false);
ponerEtapa('espacio');
reposo(false);

// Para revisar la transición cuadro a cuadro durante el desarrollo.
if (import.meta.env.DEV) {
  (window as any).recorrido = {
    mapa, dron, destino: () => destino, poseDron, camaraDeDron, vistaLejana, vistaLindero, cuadroEntrada, cuadroSalida, reposo, pegarVideo, pintarCapas, ponerCamara,
    etapa: (e: Etapa) => ponerEtapa(e),
  };
}
