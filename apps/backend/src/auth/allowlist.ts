export function parseAllowedEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

export function isEmailAllowed(email: string, allowedEmails: string[]): boolean {
  return allowedEmails.includes(email.trim().toLowerCase())
}
