import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './provider.js'
import type { Account, Category } from '../db/types.js'

// Every field is nullable because the system prompt tells the model to answer
// null when the email does not carry enough information. A non-nullable field
// here made the two contradict each other: on an unextractable email the model
// obeyed the prompt, generateObject rejected the response and threw
// NoObjectGeneratedError, and processEmail recorded a 'failed' verdict with a
// Telegram alert and three wasted retries instead of the quiet 'extract_failed'
// this case deserves.
export const extractSchema = z.object({
  description: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  account_id: z.string().nullable(),
  category_id: z.string().nullable(),
  tags: z.array(z.string()),
  created_at: z.string().nullable(),
})

export interface ExtractedTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  created_at: string
}

export interface ExtractInput {
  text: string
  categories: Category[]
  accounts: Account[]
  tags: string[]
  now: string
}

function buildSystemPrompt(input: ExtractInput): string {
  return [
    'Tienes la siguiente informacion:',
    '',
    '1. Categorias de consumo o ingreso y sus ID:',
    JSON.stringify(input.categories, null, 2),
    '',
    '2. Lista de posibles tags:',
    JSON.stringify(input.tags, null, 2),
    '',
    '3. Cuentas bancarias o tarjetas y sus ID:',
    JSON.stringify(input.accounts, null, 2),
    '',
    'Analiza el contenido del correo y devuelve los campos de la transaccion.',
    'Incluye el signo (-/+) en el monto: negativo para egresos.',
    'category_id y account_id son distintos y deben venir de las listas dadas.',
    'Si no hay informacion suficiente para un campo usa null.',
    'tags: minimo 3, en minusculas, una sola palabra por tag.',
    `Fecha y hora actual: ${input.now}. Zona horaria: America/Lima.`,
    'Si el correo usa fechas relativas, calcula created_at en formato ISO 8601.',
  ].join('\n')
}

export async function extractTransaction(input: ExtractInput): Promise<ExtractedTransaction | null> {
  const { object } = await generateObject({
    model: getModel(),
    schema: extractSchema,
    maxRetries: 2,
    system: buildSystemPrompt(input),
    prompt: `body:\n${input.text}`,
  })

  const account = input.accounts.find((candidate) => candidate.id === object.account_id)
  const category = input.categories.find((candidate) => candidate.id === object.category_id)
  if (!account || !category) {
    return null
  }

  // A transaction with no amount, currency, description or date is not a
  // transaction. Returning null routes it to the extract_failed verdict, the
  // same exit an unknown account or category takes.
  if (
    object.description === null ||
    object.amount === null ||
    object.currency === null ||
    object.created_at === null
  ) {
    return null
  }

  return {
    description: object.description,
    amount: object.amount,
    currency: object.currency,
    account_id: account.id,
    category_id: category.id,
    tags: object.tags,
    created_at: object.created_at,
  }
}
