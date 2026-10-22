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
      area_m2: z.number().positive(),
      explanacion_m2: z.number().positive().optional(),
      precio_cop: z.number().positive(),
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
        .object({ src: z.string(), poster: image(), duracion: z.string() })
        .optional(),
      // Corte corto en bucle para el hero del listado (ruta dentro de public/)
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
      contacto: z
        .object({
          nombre: z.string(),
          // Número completo con indicativo, solo dígitos (ej. 573001234567)
          whatsapp: z.string().regex(/^\d{10,15}$/),
        })
        .optional(),
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
