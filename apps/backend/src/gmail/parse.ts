import type { gmail_v1 } from 'googleapis'

export type GmailMessage = gmail_v1.Schema$Message

function decode(data: string | null | undefined): string {
  if (!data) return ''
  return Buffer.from(data, 'base64url').toString('utf8')
}

function findPartByMimeType(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): string {
  if (!part) return ''
  if (part.mimeType === mimeType && part.body?.data) {
    return decode(part.body.data)
  }
  for (const child of part.parts ?? []) {
    const found = findPartByMimeType(child, mimeType)
    if (found) return found
  }
  return ''
}

const namedEntities: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (entity) => namedEntities[entity] ?? entity)
    .replace(/&#(\d+);/g, (_entity, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_entity, codePoint: string) =>
      String.fromCodePoint(parseInt(codePoint, 16)),
    )
}

// Bank notifications are frequently html-only, so the text the AI sees has to
// come out of the markup. Tags become newlines rather than nothing so that
// table cells ("Monto</td><td>S/ 35.00") do not fuse into one token; the
// whitespace collapse in parseMessage then flattens the result.
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, '\n'),
  )
}

function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  const plain = findPartByMimeType(payload, 'text/plain')
  if (plain) return plain

  const html = findPartByMimeType(payload, 'text/html')
  if (html) return htmlToText(html)

  // Last resort for single-part messages that declare no mime type at all.
  if (payload?.body?.data && !payload.mimeType) {
    return decode(payload.body.data)
  }
  return ''
}

export function parseMessage(message: GmailMessage): {
  subject: string
  text: string
  sender: string | null
  internalDateSeconds: string
} {
  const headers = message.payload?.headers ?? []
  const subjectHeader = headers.find((header) => header.name?.toLowerCase() === 'subject')
  // The From header is kept verbatim ("Bank Name <no-reply@bank.com>"): the
  // display name is the useful half and parsing RFC 5322 addresses to split it
  // is not worth it here.
  const fromHeader = headers.find((header) => header.name?.toLowerCase() === 'from')
  const rawText = extractBodyText(message.payload ?? undefined)
  const text = rawText.replace(/\s+/g, ' ').trim()
  // Gmail's internalDate is milliseconds since epoch as a string; the poller
  // cursor works in seconds to match the messages.list after: query.
  const internalDateMillis = message.internalDate ?? '0'
  const internalDateSeconds = String(Math.floor(Number(internalDateMillis) / 1000))
  return {
    subject: subjectHeader?.value ?? '',
    text,
    sender: fromHeader?.value ?? null,
    internalDateSeconds,
  }
}
