import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const lotes = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/lotes' }),
  schema: ({ image }) =>
    z.object({
      nombre: z.string(),
      tagline: z.string(),
      resumen: z.string(),
      municipio: z.string(),
      departamento: z.string(),
      vereda: z.string().optional(),
      // Parcelaciones: area_m2 y precio_cop son el mínimo; area_max_m2 y precio_max_cop el máximo del rango
      area_m2: z.number().positive(),
      area_max_m2: z.number().positive().optional(),
      explanacion_m2: z.number().positive().optional(),
      // Sin precio_cop el lote se publica como "Precio a consultar"
      precio_cop: z.number().positive().optional(),
      precio_max_cop: z.number().positive().optional(),
      // Lotes de una parcelación (nombre y área; precio y estado si se conocen)
      unidades: z
        .array(
          z.object({
            nombre: z.string(),
            area_m2: z.number().positive(),
            precio_cop: z.number().positive().optional(),
            estado: z.enum(['disponible', 'reservado', 'vendido']).default('disponible'),
          }),
        )
        .default([]),
      estado: z.enum(['disponible', 'reservado', 'vendido']),
      destacado: z.boolean().default(false),
      demo: z.boolean().default(false),
      orden: z.number().default(100),
      atributos: z.array(z.string()).default([]),
      // Cifras grandes de la ficha; si faltan se arman con área, explanación y precio
      cifras: z.array(z.object({ valor: z.string(), etiqueta: z.string() })).max(4).optional(),
      cercanias: z
        .array(z.object({ lugar: z.string(), minutos: z.number().optional() }))
        .default([]),
      portada: image().optional(),
      galeria: z.array(z.object({ src: image(), alt: z.string() })).default([]),
      ubicacion: z.object({ src: image(), alt: z.string() }).optional(),
      // Recorrido completo (vuelo 3D + lote). src es una ruta dentro de public/
      video_completo: z
        // descripcion: línea bajo "Ver el recorrido completo" (por defecto "Desde el espacio hasta el lote")
        .object({ src: z.string(), poster: image(), duracion: z.string(), descripcion: z.string().optional() })
        .optional(),
      // Vuelo del planeta al lote (hero del inicio y botón "Ver el vuelo"). src es una ruta dentro de public/;
      // poster es el primer cuadro, final el último (lote resaltado) y etapas marcan la línea de tiempo
      vuelo: z
        .object({
          src: z.string(),
          poster: image(),
          final: image(),
          duracion_s: z.number().positive(),
          etapas: z.array(z.object({ nombre: z.string(), desde_s: z.number().min(0) })).min(1),
        })
        .optional(),
      // Corte corto en bucle para el hero del listado cuando no hay vuelo (ruta dentro de public/)
      teaser: z.string().optional(),
      // Versión vertical (9:16) del recorrido para redes y WhatsApp (ruta dentro de public/)
      video_vertical: z.string().optional(),
      // Punto del lote para "Cómo llegar"; aproximadas: true avisa que no es el punto exacto
      coordenadas: z
        .object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
          aproximadas: z.boolean().default(true),
        })
        .optional(),
      // Globo 3D (/globo/): punto del marcador si difiere de coordenadas (lotes demo), altura del terreno en metros
      // y cámara de llegada. El lindero vive en public/capas/lindero-<id>.geojson (se dibuja en /globo/ en desarrollo)
      mapa: z
        .object({
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          alt: z.number().optional(),
          camara: z
            .object({ range: z.number().positive(), tilt: z.number().min(0).max(90), heading: z.number() })
            .optional(),
        })
        .optional(),
      contacto: z
        .object({
          nombre: z.string(),
          // Número completo con indicativo, solo dígitos (ej. 573001234567)
          whatsapp: z.string().regex(/^\d{10,15}$/),
        })
        .optional(),
      // Frase grande que abre la ficha: principal en blanco y atenuada a continuación
      frase: z.object({ principal: z.string(), atenuada: z.string().optional() }).optional(),
      // Capítulos del recorrido por scroll de la ficha; video es una ruta dentro de public/
      historia: z
        .array(
          z.object({
            etiqueta: z.string(),
            titulo: z.string(),
            texto: z.string(),
            media: image(),
            video: z.string().optional(),
            // true: el video es movimiento generado a partir de una foto real (solo informativo, no se muestra)
            ia: z.boolean().optional(),
          }),
        )
        .default([]),
      // Índice (base 0) de la galería que se muestra como foto del mosaico; si falta, la primera no usada en la historia
      foto_mosaico: z.number().int().min(0).optional(),
      recorrido: z
        .array(
          z.object({
            titulo: z.string(),
            descripcion: z.string(),
            poster: image(),
            video: z.string().optional(),
          }),
        )
        .default([]),
    }),
});

export const collections = { lotes };
