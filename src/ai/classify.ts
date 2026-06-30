import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './provider.js'
import type { Category } from '../db/types.js'

const schema = z.object({
  category_id: z.string(),
  tags: z.array(z.string()),
})

export interface ClassifyInput {
  description: string
  categories: Category[]
  tags: string[]
}

export async function classifyEdit(input: ClassifyInput): Promise<{ category_id: string; tags: string[] }> {
  const system = [
    'Eres experto clasificando descripciones de transacciones monetarias.',
    'Devuelve el category_id que mejor calza y una lista de tags relevantes.',
    'Categorias de referencia:',
    JSON.stringify(input.categories, null, 2),
    'Tags de referencia:',
    JSON.stringify(input.tags, null, 2),
    'tags: en minusculas, una sola palabra por tag.',
  ].join('\n')

  const { object } = await generateObject({
    model: getModel(),
    schema,
    maxRetries: 2,
    system,
    prompt: `Descripcion: ${input.description}`,
  })
  return object
}
