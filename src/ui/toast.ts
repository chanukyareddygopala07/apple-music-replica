/** Toast notifications with optional action button. */

import { qs } from '@/ui/el'

export interface ToastOptions {
  message: string
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

export function ensureToastRegion(): HTMLElement {
  let region = qs('.toast-region')
  if (!region) {
    region = document.createElement('div')
    region.className = 'toast-region'
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    document.body.appendChild(region)
  }
  return region
}

export function showToast(opts: ToastOptions): void {
  const region = ensureToastRegion()
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = `<span class="toast-msg"></span>`
  const msg = el.querySelector('.toast-msg')
  if (msg) msg.textContent = opts.message
  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'toast-action'
    btn.textContent = opts.actionLabel
    btn.addEventListener('click', () => {
      opts.onAction?.()
      el.remove()
    })
    el.appendChild(btn)
  }
  region.appendChild(el)
  const ttl = opts.durationMs ?? (opts.actionLabel ? 7000 : 3800)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity 200ms'
    setTimeout(() => el.remove(), 220)
  }, ttl)
}
