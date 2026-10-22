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
      cercanias: z
        .array(z.object({ lugar: z.string(), minutos: z.number().optional() }))
        .default([]),
      portada: image().optional(),
      galeria: z.array(z.object({ src: image(), alt: z.string() })).default([]),
      ubicacion: z.object({ src: image(), alt: z.string() }).optional(),
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
