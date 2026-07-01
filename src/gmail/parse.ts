import type { gmail_v1 } from 'googleapis'

export type GmailMessage = gmail_v1.Schema$Message

function decode(data: string | null | undefined): string {
  if (!data) return ''
  return Buffer.from(data, 'base64url').toString('utf8')
}

function findTextPart(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decode(part.body.data)
  }
  for (const child of part.parts ?? []) {
    const found = findTextPart(child)
    if (found) return found
  }
  if (part.body?.data && (!part.mimeType || part.mimeType === 'text/plain')) {
    return decode(part.body.data)
  }
  return ''
}

export function parseMessage(message: GmailMessage): { subject: string; text: string } {
  const headers = message.payload?.headers ?? []
  const subjectHeader = headers.find((header) => header.name?.toLowerCase() === 'subject')
  const rawText = findTextPart(message.payload ?? undefined)
  const text = rawText.replace(/\s*\n+\s*/g, ' ').trim()
  return { subject: subjectHeader?.value ?? '', text }
}
