import type { Context } from 'hono'
import { z } from 'zod'

export function zodErrorMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join(', ')
}

export type ParsedBody<T> = { success: true; data: T } | { success: false; error: string }

// Reads and validates a JSON request body. Collapses the identical
// parse-JSON-then-zod-validate dance every POST/PATCH handler would otherwise
// repeat: on failure the caller returns `context.json({ error }, 400)`.
export async function parseJsonBody<Schema extends z.ZodTypeAny>(
  context: Context,
  schema: Schema,
): Promise<ParsedBody<z.infer<Schema>>> {
  let body: unknown
  try {
    body = await context.req.json()
  } catch {
    return { success: false, error: 'Invalid JSON body' }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return { success: false, error: zodErrorMessage(parsed.error) }
  }
  return { success: true, data: parsed.data }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
