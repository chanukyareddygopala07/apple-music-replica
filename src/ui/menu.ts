/** Lightweight popover menu anchored to an element. */

import { qs } from '@/ui/el'

export interface MenuEntry {
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface MenuSeparator {
  separator: true
}

export type MenuItem = MenuEntry | MenuSeparator

let openMenu: { el: HTMLElement; cleanup: () => void } | null = null

export function closeMenu(): void {
  if (!openMenu) return
  openMenu.el.remove()
  openMenu.cleanup()
  openMenu = null
}

export function openContextualMenu(anchor: HTMLElement, items: MenuItem[]): void {
  closeMenu()
  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.setAttribute('role', 'menu')
  for (const item of items) {
    if ('separator' in item) {
      const sep = document.createElement('div')
      sep.className = 'menu-sep'
      menu.appendChild(sep)
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `menu-item${item.danger ? ' danger' : ''}`
    btn.setAttribute('role', 'menuitem')
    btn.textContent = item.label
    btn.disabled = Boolean(item.disabled)
    btn.addEventListener('click', () => {
      closeMenu()
      item.onSelect()
    })
    menu.appendChild(btn)
  }
  document.body.appendChild(menu)

  const rect = anchor.getBoundingClientRect()
  const mw = menu.offsetWidth
  const mh = menu.offsetHeight
  let left = Math.min(rect.left, window.innerWidth - mw - 12)
  let top = rect.bottom + 6
  if (top + mh > window.innerHeight - 12) top = Math.max(12, rect.top - mh - 6)
  left = Math.max(12, left)
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`

  const onDocClick = (ev: Event) => {
    if (!menu.contains(ev.target as Node)) closeMenu()
  }
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      closeMenu()
      anchor.focus()
    }
  }
  const cleanup = () => {
    document.removeEventListener('mousedown', onDocClick)
    document.removeEventListener('keydown', onKey)
  }
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKey)
  openMenu = { el: menu, cleanup }
  qs<HTMLButtonElement>('.menu-item:not(:disabled)', menu)?.focus()
}
