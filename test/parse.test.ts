import { describe, it, expect } from 'vitest'
import { parseMessage } from '../src/gmail/parse.js'

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

describe('parseMessage', () => {
  it('reads subject and decodes a simple text body', () => {
    const result = parseMessage({
      payload: {
        headers: [{ name: 'Subject', value: 'Consumo BCP' }],
        mimeType: 'text/plain',
        body: { data: encode('Realizaste un consumo\n\nde S/ 35.00') },
      },
    })
    expect(result.subject).toBe('Consumo BCP')
    expect(result.text).toBe('Realizaste un consumo de S/ 35.00')
  })

  it('finds the text/plain part in a multipart message', () => {
    const result = parseMessage({
      payload: {
        headers: [{ name: 'Subject', value: 'Multi' }],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: encode('<p>hi</p>') } },
          { mimeType: 'text/plain', body: { data: encode('plain body') } },
        ],
      },
    })
    expect(result.text).toBe('plain body')
  })
})
