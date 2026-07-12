import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library does not auto-register its DOM cleanup unless `afterEach`
// is a global, and this project does not enable Vitest's `globals` option.
// Without this, elements from one test's render (and their pointer-events
// lock on <body> from Radix dialogs) leak into the next test.
afterEach(() => {
  cleanup()
})

// jsdom lacks several DOM APIs that Radix UI (Select, Popover, Dialog) relies on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
