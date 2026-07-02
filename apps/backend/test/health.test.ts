import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'

describe('health route', () => {
  it('returns ok', async () => {
    const app = buildApp()
    const response = await app.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
