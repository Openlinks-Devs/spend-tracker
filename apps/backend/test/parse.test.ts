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

  it('returns the From header verbatim as the sender', () => {
    const result = parseMessage({
      payload: {
        headers: [
          { name: 'Subject', value: 'Consumo BCP' },
          { name: 'From', value: 'Banco BCP <notificaciones@bcp.com.pe>' },
        ],
        mimeType: 'text/plain',
        body: { data: encode('body') },
      },
    })
    expect(result.sender).toBe('Banco BCP <notificaciones@bcp.com.pe>')
  })

  it('returns a null sender when the message has no From header', () => {
    const result = parseMessage({
      payload: {
        headers: [{ name: 'Subject', value: 'No sender' }],
        mimeType: 'text/plain',
        body: { data: encode('body') },
      },
    })
    expect(result.sender).toBeNull()
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

describe('parseMessage with html bodies', () => {
  it('falls back to the html part when there is no text/plain part', () => {
    const result = parseMessage({
      payload: {
        headers: [{ name: 'Subject', value: 'Consumo' }],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: encode('<p>Consumo por</p><b>S/ 35.00</b>') } },
        ],
      },
    })
    expect(result.text).toBe('Consumo por S/ 35.00')
  })

  it('reads a single-part html message', () => {
    const result = parseMessage({
      payload: {
        headers: [{ name: 'Subject', value: 'Consumo' }],
        mimeType: 'text/html',
        body: { data: encode('<html><body><div>Compra de S/ 12.50</div></body></html>') },
      },
    })
    expect(result.text).toBe('Compra de S/ 12.50')
  })

  it('keeps adjacent table cells apart', () => {
    const result = parseMessage({
      payload: {
        mimeType: 'text/html',
        body: { data: encode('<table><tr><td>Monto</td><td>S/ 35.00</td></tr></table>') },
      },
    })
    expect(result.text).toBe('Monto S/ 35.00')
  })

  it('decodes html entities', () => {
    const result = parseMessage({
      payload: {
        mimeType: 'text/html',
        body: { data: encode('<p>Total:&nbsp;S/&#160;35.00 &amp; comisi&#243;n</p>') },
      },
    })
    expect(result.text).toBe('Total: S/ 35.00 & comisión')
  })

  it('drops style and script content', () => {
    const result = parseMessage({
      payload: {
        mimeType: 'text/html',
        body: {
          data: encode(
            '<style>.total{color:red}</style><script>var total = 1;</script><p>Consumo S/ 9.00</p>',
          ),
        },
      },
    })
    expect(result.text).toBe('Consumo S/ 9.00')
  })

  it('strips html comments', () => {
    const result = parseMessage({
      payload: {
        mimeType: 'text/html',
        body: { data: encode('<!--[if mso]><i></i><![endif]--><p>Consumo S/ 4.00</p>') },
      },
    })
    expect(result.text).toBe('Consumo S/ 4.00')
  })
})
