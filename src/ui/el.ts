/** Tiny DOM helpers: html templating, escaping, event delegation, images. */

import { artworkDataUrl } from '@/utils/artwork'

export function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel)
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel)]
}

/**
 * Event delegation: call `on(root, 'click', '[data-action]', handler)`.
 * The handler receives the matching element + the original event.
 */
export function on<K extends keyof HTMLElementEventMap>(
  root: ParentNode,
  type: K | string,
  selector: string,
  handler: (el: HTMLElement, ev: HTMLElementEventMap[K]) => void,
): () => void {
  const listener = (ev: Event) => {
    const target = ev.target as Element | null
    if (!target || !root.contains(target)) return
    const match = target.closest<HTMLElement>(selector)
    if (!match || !root.contains(match)) return
    handler(match, ev as HTMLElementEventMap[K])
  }
  root.addEventListener(type as string, listener)
  return () => root.removeEventListener(type as string, listener)
}

/** <img> markup with graceful fallback to generated artwork. */
export function artImg(seed: string, alt: string, cls = '', opts?: { round?: boolean; sizes?: string }): string {
  const src = artworkDataUrl(seed, opts)
  return `<img class="${cls}" src="${src}" alt="${escapeHtml(alt)}" draggable="false" ${opts?.sizes ? `sizes="${opts.sizes}"` : ''} data-seed="${escapeHtml(seed)}" />`
}

/** Ensure every seeded <img> has generated artwork; replace broken images with a fallback block. */
export function attachArtworkFallback(root: ParentNode): void {
  qsa<HTMLImageElement>('img[data-seed]', root).forEach((img) => {
    const seed = img.dataset.seed ?? ''
    if (!img.getAttribute('src') && seed) {
      img.src = artworkDataUrl(seed)
    }
    if (img.dataset.fallbackBound === '1') return
    img.dataset.fallbackBound = '1'
    img.addEventListener('error', () => {
      if (seed && !img.src.startsWith('data:')) {
        img.src = artworkDataUrl(seed)
        return
      }
      const div = document.createElement('div')
      div.className = img.className ? `${img.className} art-fallback` : 'art-fallback'
      div.setAttribute('role', 'img')
      div.setAttribute('aria-label', img.alt || 'Artwork')
      div.textContent = (img.alt || '?').slice(0, 1)
      img.replaceWith(div)
    })
  })
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
