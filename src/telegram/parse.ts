export function parseTransactionId(replyText: string): string | null {
  const match = replyText.match(/ID:\s*(.+)/)
  return match ? match[1].trim() : null
}

export function parseEdit(messageText: string): { description: string; tags: string[] } {
  const description = messageText.split('\n')[0].trim()
  const bracket = messageText.match(/\[([^\]]+)\]/)
  const tags = bracket
    ? bracket[1].split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0)
    : []
  return { description, tags }
}
