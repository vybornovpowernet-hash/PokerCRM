import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

if (typeof window !== 'undefined' && !window.ResizeObserver) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

window.scrollTo = () => undefined

if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = (() => []) as unknown as typeof Range.prototype.getClientRects
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () =>
      ({ width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  }
}

if (typeof document !== 'undefined') {
  if (typeof document.elementFromPoint !== 'function') {
    Object.defineProperty(document, 'elementFromPoint', { writable: true, value: () => null })
  }
  if (typeof (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint !== 'function') {
    Object.defineProperty(document, 'caretRangeFromPoint', { writable: true, value: () => null })
  }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false
    }) as MediaQueryList
}
