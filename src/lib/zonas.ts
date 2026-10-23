// Zonas del globo: subregiones de Antioquia que agrupan los lotes en la vista país.
// La cámara de cada zona se calcula con sus lotes (globo.ts); un municipio sin zona cae en "Antioquia"

export interface Zona {
  id: string;
  nombre: string;
}

const ZONAS: Record<string, Zona> = {
  aburra: { id: 'aburra', nombre: 'Valle de Aburrá' },
  oriente: { id: 'oriente', nombre: 'Oriente' },
  norte: { id: 'norte', nombre: 'Norte' },
  antioquia: { id: 'antioquia', nombre: 'Antioquia' },
};

const MUNICIPIO_ZONA: Record<string, string> = {
  Girardota: 'aburra',
  Barbosa: 'aburra',
  Copacabana: 'aburra',
  Bello: 'aburra',
  Medellín: 'aburra',
  Envigado: 'aburra',
  Guarne: 'oriente',
  Rionegro: 'oriente',
  'El Retiro': 'oriente',
  'La Ceja': 'oriente',
  Marinilla: 'oriente',
  'San Vicente': 'oriente',
  'San Pedro de los Milagros': 'norte',
  Entrerríos: 'norte',
  'Don Matías': 'norte',
  Belmira: 'norte',
};

export const zonaDe = (municipio: string): Zona => ZONAS[MUNICIPIO_ZONA[municipio] ?? 'antioquia'];
