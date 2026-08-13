import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectionAlert } from './ConnectionAlert'
import type { Connection } from '@/types'

function brokenConnection(email: string): Connection {
  return {
    id: `conn-${email}`,
    provider: 'gmail',
    status: 'needs_reauth',
    external_id: email,
    created_at: '2026-08-01T00:00:00.000Z',
  }
}

function renderAlert(connections: Connection[]) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ConnectionAlert brokenConnections={connections} />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('ConnectionAlert', () => {
  it('renders nothing when every connection is healthy', () => {
    const { container } = renderAlert([])
    expect(container).toBeEmptyDOMElement()
  })

  it('names the account that stopped importing', () => {
    renderAlert([brokenConnection('misael@gmail.com')])
    expect(screen.getByText(/misael@gmail\.com/)).toBeInTheDocument()
  })

  it('names every broken account when several are down', () => {
    renderAlert([brokenConnection('one@gmail.com'), brokenConnection('two@gmail.com')])
    expect(screen.getByText(/one@gmail\.com/)).toBeInTheDocument()
    expect(screen.getByText(/two@gmail\.com/)).toBeInTheDocument()
  })

  it('offers a link to the integrations screen to fix it', () => {
    renderAlert([brokenConnection('misael@gmail.com')])
    expect(screen.getByRole('link', { name: /reconnect/i })).toHaveAttribute('href', '/integrations')
  })

  it('hides itself once dismissed', () => {
    const { container } = renderAlert([brokenConnection('misael@gmail.com')])
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(container).toBeEmptyDOMElement()
  })
})
