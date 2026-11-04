/** Motion helpers: per-character heading reveal + reduced-motion check.
    Kept tiny and dependency-free; used by the shell on route changes. */

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Split a heading's text into per-char spans so CSS can animate them in.
    The visible text stays identical (textContent concatenates to the same
    string) and an aria-label preserves the accessible name. */
export function revealHeading(h: HTMLElement): void {
  const text = (h.textContent ?? '').trim()
  if (!text) return
  h.setAttribute('aria-label', text)
  h.classList.add('reveal-text')
  h.textContent = ''
  Array.from(text).forEach((ch, i) => {
    const span = document.createElement('span')
    span.className = 'ch'
    span.setAttribute('aria-hidden', 'true')
    span.style.setProperty('--c', String(i))
    span.textContent = ch
    h.appendChild(span)
  })
}

/** Stagger direct children of a freshly rendered view. */
export function staggerView(view: HTMLElement): void {
  view.classList.add('view-enter')
  Array.from(view.children).forEach((child, i) => {
    ;(child as HTMLElement).style.setProperty('--stagger', String(Math.min(i * 45, 460)))
  })
}
