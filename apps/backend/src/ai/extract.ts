import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './provider.js'
import type { Account, Category } from '../db/types.js'

const schema = z.object({
  description: z.string(),
  amount: z.number(),
  currency: z.string(),
  account_id: z.string().nullable(),
  category_id: z.string().nullable(),
  tags: z.array(z.string()),
  payee: z.string().nullable(),
  occurred_at: z.string(),
})

export interface ExtractedTransaction {
  description: string
  amount: number
  currency: string
  account_id: string
  category_id: string
  tags: string[]
  payee: string | null
  occurred_at: string
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
    'currency: codigo ISO 4217 en mayusculas (PEN, USD, EUR, ...).',
    'payee: nombre del comercio o de la persona que recibe o envia el dinero; null si no se puede determinar.',
    'category_id y account_id son distintos y deben venir de las listas dadas.',
    'Si no hay informacion suficiente para un campo usa null.',
    'tags: minimo 3, en minusculas, una sola palabra por tag.',
    `Fecha y hora actual: ${input.now}. Zona horaria: America/Lima.`,
    'occurred_at: fecha y hora de la transaccion segun el correo, en formato ISO 8601.',
    'Si el correo usa fechas relativas, calcula occurred_at; si no indica fecha, usa la fecha del correo.',
  ].join('\n')
}

export async function extractTransaction(input: ExtractInput): Promise<ExtractedTransaction | null> {
  const { object } = await generateObject({
    model: getModel(),
    schema,
    maxRetries: 2,
    system: buildSystemPrompt(input),
    prompt: `body:\n${input.text}`,
  })

  const account = input.accounts.find((candidate) => candidate.id === object.account_id)
  const category = input.categories.find((candidate) => candidate.id === object.category_id)
  if (!account || !category) {
    return null
  }

  return {
    description: object.description,
    amount: object.amount,
    currency: object.currency,
    account_id: account.id,
    category_id: category.id,
    tags: object.tags,
    payee: object.payee,
    occurred_at: object.occurred_at,
  }
}
