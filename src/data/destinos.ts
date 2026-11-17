// Destinos del recorrido "del espacio al lote".
// Un destino "completo" tiene toma de dron del mismo lugar al que llega el globo.
// Un destino "satelite" todavía no tiene vuelo de dron: el recorrido termina en la imagen satelital.

export type Punto = [lng: number, lat: number];

/**
 * Trayectoria de la cámara del dron durante la toma: dónde estaba y hacia dónde miraba en cada instante.
 * Con ella el mapa puede ponerse exactamente en el punto de vista del video, y el video puede
 * "pegarse" al terreno en perspectiva mientras la cámara del mapa entra o sale de él.
 *
 * Cada magnitud es un polinomio [c0, c1, c2] en k = (t - medio) / medio, con t en segundos.
 * Con un dron propio estos datos salen de la telemetría del vuelo; para este video público
 * se ajustaron contra el catastro y la topografía oficial (parcela, cerca, camino y estanque).
 */
export type CamaraDron = {
  /** Campo visual vertical del cuadro completo, en grados. */
  fov: number;
  /** Proporción del video (ancho / alto). */
  aspecto: number;
  /** Origen de los metros locales (este, norte). */
  origen: Punto;
  medio: number;
  /** Posición de la cámara en metros locales y altura sobre el terreno. */
  este: number[];
  norte: number[];
  altura: number[];
  /** Rumbo del eje óptico (grados desde el norte) e inclinación (grados desde la vertical hacia abajo). */
  rumbo: number[];
  inclinacion: number[];
};

export type Destino = {
  id: string;
  nombre: string;
  lugar: string;
  estado: 'completo' | 'satelite';
  centro: Punto;
  /** Vista con la que termina el vuelo del globo. */
  llegada: { zoom: number; pitch: number; bearing: number };
  /** Nombre que se muestra durante el descenso mientras el zoom sea menor que "hasta". */
  escalas: { hasta: number; nombre: string }[];
  /**
   * archivoLiviano: la misma toma en menor resolución, para quien activó el ahorro de datos.
   * linderoA: segundo de la toma en el que el recorrido sigue solo hacia el lindero y las medidas
   * la primera vez que se llega al lote. Sin este dato espera al final del video.
   */
  video?: { archivo: string; archivoLiviano?: string; linderoA?: number; credito: string; camara: CamaraDron };
  /**
   * Fotografía aérea de detalle para la llegada. Hace el papel de la ortofoto de dron en un lote propio:
   * tomada en verano, como el video, así el terreno del mapa se parece al de la toma.
   */
  ortofoto?: { teselas: string; atribucion: string; limites: [oeste: number, sur: number, este: number, norte: number]; zoomMax: number };
  /** Vértices del lindero, sin repetir el primero. */
  lindero?: Punto[];
  /** De dónde sale el lindero y, si la hay, el área oficial en m². */
  linderoFuente?: string;
  areaOficial?: number;
  cifras: { valor: string; etiqueta: string }[];
  cercanias?: string[];
};

const RADIO = 6371008.8;
const rad = (g: number) => (g * Math.PI) / 180;

export function distancia(a: Punto, b: Punto): number {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * RADIO * Math.asin(Math.sqrt(h));
}

export function area(vertices: Punto[]): number {
  const [lng0, lat0] = vertices[0];
  const xy = vertices.map(([lng, lat]) => [rad(lng - lng0) * RADIO * Math.cos(rad(lat0)), rad(lat - lat0) * RADIO]);
  let suma = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    suma += x1 * y2 - x2 * y1;
  }
  return Math.abs(suma) / 2;
}

export const lados = (v: Punto[]) => v.map((p, i) => ({ desde: p, hasta: v[(i + 1) % v.length], metros: distancia(p, v[(i + 1) % v.length]) }));
export const perimetro = (v: Punto[]) => lados(v).reduce((s, l) => s + l.metros, 0);
export const miles = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

// Pradera real junto al hunebed D15, al norte de Loon (Drenthe).
// Lindero oficial: parcela catastral Assen AA 152 (Kadaster, vía PDOK), 9.417 m².
// Orden: esquina este, norte, oeste, quiebre sobre el camino y sur.
const linderoPradera: Punto[] = [
  [6.616472232919319, 53.023267698426814],
  [6.6154653316589656, 53.023515641965],
  [6.614563745260214, 53.02248494774839],
  [6.615029061808418, 53.022417711828396],
  [6.615522406405878, 53.02216770490674],
];
const ladosPradera = lados(linderoPradera).map((l) => l.metros);
const largo = Math.round((ladosPradera[1] + ladosPradera[4]) / 2); // los dos costados largos
const ancho = Math.round(ladosPradera[0]); // el extremo nororiental

export const destinos: Destino[] = [
  {
    id: 'pradera',
    nombre: 'Pradera entre árboles',
    lugar: 'Loon, Países Bajos',
    estado: 'completo',
    centro: [6.61543, 53.0228],
    // Mismo rumbo con el que empieza la toma de dron: el descenso final continúa en línea hacia ella.
    llegada: { zoom: 15.8, pitch: 58, bearing: 77 },
    escalas: [
      { hasta: 3, nombre: 'Planeta Tierra' },
      { hasta: 5.5, nombre: 'Europa' },
      { hasta: 8.5, nombre: 'Países Bajos' },
      { hasta: 11.5, nombre: 'Drenthe' },
      { hasta: 14.3, nombre: 'Loon' },
      { hasta: 99, nombre: 'El lote' },
    ],
    video: {
      // La original de 2560×1440 (45 MB) quedó fuera del sitio, en prep/video-original: pasa del tope
      // por archivo de Cloudflare Pages y en pantalla no se distingue de esta.
      archivo: 'lotes/demo/parcela-dron-1080p.mp4', // 1920×1080, 19 MB
      archivoLiviano: 'lotes/demo/parcela-dron-720p.mp4', // 1280×720, 10 MB
      linderoA: 12,
      credito: 'Matthias Groeneveld, Pixabay',
      // El dron rodea la esquina sur de la pradera a unos 42 m de altura, girando de este-noreste a norte.
      camara: {
        fov: 44.724,
        aspecto: 16 / 9,
        origen: [6.6154, 53.023],
        medio: 13,
        este: [-65.348, 52.969, 18.197],
        norte: [-103.789, -36.22, 15.716],
        altura: [42.368, 0.123, 0],
        rumbo: [34.967, -39.324, 2.545],
        inclinacion: [66.645, 0, 0],
      },
    },
    ortofoto: {
      // Vuelo de verano de 2025: el de 2023 tiene una bruma lechosa que se nota al acercarse.
      teselas: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/2025_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg',
      // Fuentes de la foto aérea y del lindero. No se muestran en pantalla: el botón de créditos del mapa se quitó.
      atribucion: 'Beeldmateriaal Nederland y Kadaster, PDOK',
      limites: [6.45, 52.93, 6.85, 53.12],
      zoomMax: 19,
    },
    lindero: linderoPradera,
    linderoFuente: 'parcela catastral Assen AA 152',
    areaOficial: 9417,
    cifras: [
      { valor: '9.417 m²', etiqueta: 'Área catastral' },
      { valor: `${largo} × ${ancho} m`, etiqueta: 'Largo y ancho' },
      { valor: 'Plano', etiqueta: 'Terreno' },
    ],
    cercanias: ['Dolmen D15 a 170 m', 'Loon a 1 km', 'Assen a 5 km'],
  },
  {
    id: 'mirador-del-norte',
    nombre: 'Lote Mirador del Norte',
    lugar: 'Girardota, Antioquia',
    estado: 'satelite',
    centro: [-75.438164, 6.407989],
    llegada: { zoom: 15.3, pitch: 50, bearing: -20 },
    escalas: [
      { hasta: 3, nombre: 'Planeta Tierra' },
      { hasta: 5, nombre: 'Suramérica' },
      { hasta: 7.5, nombre: 'Colombia' },
      { hasta: 10.5, nombre: 'Antioquia' },
      { hasta: 13.5, nombre: 'Girardota' },
      { hasta: 99, nombre: 'Vereda Mercedes Ábrego' },
    ],
    cifras: [
      { valor: '3.800 m²', etiqueta: 'Área total' },
      { valor: '1.000 m²', etiqueta: 'Ya explanados' },
      { valor: '15 min', etiqueta: 'Al parque de Girardota' },
    ],
  },
  {
    id: 'villas-de-prado-verde',
    nombre: 'Villas de Prado Verde',
    lugar: 'Guarne, Antioquia',
    estado: 'satelite',
    centro: [-75.4026, 6.329],
    llegada: { zoom: 15.3, pitch: 50, bearing: 20 },
    escalas: [
      { hasta: 3, nombre: 'Planeta Tierra' },
      { hasta: 5, nombre: 'Suramérica' },
      { hasta: 7.5, nombre: 'Colombia' },
      { hasta: 10.5, nombre: 'Antioquia' },
      { hasta: 13.5, nombre: 'Guarne' },
      { hasta: 99, nombre: 'Vereda Yolombal' },
    ],
    cifras: [
      { valor: '9', etiqueta: 'Lotes en dos etapas' },
      { valor: '963 a 2.450 m²', etiqueta: 'Áreas' },
      { valor: '10 min', etiqueta: 'Al parque de Guarne' },
    ],
  },
];
