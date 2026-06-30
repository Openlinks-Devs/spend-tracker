import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel } from './provider.js'

const transactionSchema = z.object({ is_transaction_email: z.boolean() })

const systemPrompt =
  'Eres un experto clasificando textos. Devuelve is_transaction_email=true si y solo si ' +
  'el correo describe una transaccion monetaria, consumo con tarjeta, movimiento o ' +
  'transferencia bancaria. Los textos promocionales, publicitarios o de marketing son false.'

export async function detectTransaction(input: { subject: string; text: string }): Promise<boolean> {
  const { object } = await generateObject({
    model: getModel(),
    schema: transactionSchema,
    maxRetries: 2,
    system: systemPrompt,
    prompt: `Subject: ${input.subject}\n\nBody: ${input.text}`,
  })
  return object.is_transaction_email
}
