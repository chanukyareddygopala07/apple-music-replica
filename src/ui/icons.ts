/**
 * Original stroke-based icon set (SF-Symbols-like geometry, hand-authored).
 * Returns SVG markup strings; all use currentColor.
 */

const SVG = (paths: string, opts?: { fill?: boolean }) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${
    opts?.fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
  }>${paths}</svg>`

export type IconName = keyof typeof ICONS

export const ICONS = {
  search: SVG('<circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/>'),
  home: SVG('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>'),
  browse: SVG('<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>'),
  radio: SVG('<circle cx="12" cy="14" r="2.2"/><path d="M7.5 10.5a6 6 0 0 0 0 7M16.5 10.5a6 6 0 0 1 0 7M4.8 7.8a10 10 0 0 0 0 12.4M19.2 7.8a10 10 0 0 1 0 12.4"/>'),
  library: SVG('<path d="M5 5v14M9.5 5v14M13.2 6.2l4.6 12.4"/>'),
  heart: SVG('<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>'),
  'heart-fill': SVG('<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>', { fill: true }),
  play: SVG('<path d="M8 5.5v13l11-6.5z"/>', { fill: true }),
  pause: SVG('<rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/>', { fill: true }),
  next: SVG('<path d="M6 6.5v11l8.5-5.5zM16 6h2.2v12H16z"/>', { fill: true }),
  prev: SVG('<path d="M18 6.5v11L9.5 12zM8 6H5.8v12H8z"/>', { fill: true }),
  shuffle: SVG('<path d="M4 7h2.5l3 4M20 7h-3l-7 10H4M20 17h-3l-2.2-3.1M16.5 19.5l2.5-2.5-2.5-2.5M7 4.5 4.5 7 7 9.5"/>'),
  repeat: SVG('<path d="M17 3.5 20.5 7 17 10.5M3.5 12V9.5A2.5 2.5 0 0 1 6 7h14M7 20.5 3.5 17 7 13.5M20.5 12v2.5a2.5 2.5 0 0 1-2.5 2.5H4"/>'),
  'repeat-1': SVG('<path d="M17 3.5 20.5 7 17 10.5M3.5 12V9.5A2.5 2.5 0 0 1 6 7h14M7 20.5 3.5 17 7 13.5M20.5 12v2.5a2.5 2.5 0 0 1-2.5 2.5H4"/><path d="M11.2 10.2l1.6-1v5" stroke-width="1.6"/>'),
  volume: SVG('<path d="M4 10v4h3l4 3.5v-15L7 10zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>'),
  'volume-mute': SVG('<path d="M4 10v4h3l4 3.5v-15L7 10zM15.5 10l5 4M20.5 10l-5 4"/>'),
  queue: SVG('<path d="M4 6h12M4 11h12M4 16h8"/><path d="M18 12.5v7l5-3.5z" fill="currentColor" stroke="none"/>'),
  lyrics: SVG('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/>'),
  more: SVG('<circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  'chevron-left': SVG('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  'chevron-right': SVG('<path d="M9.5 5.5 16 12l-6.5 6.5"/>'),
  'chevron-down': SVG('<path d="M6 9.5 12 15.5 18 9.5"/>'),
  close: SVG('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: SVG('<path d="M12 5v14M5 12h14"/>'),
  trash: SVG('<path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"/>'),
  drag: SVG('<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>'),
  check: SVG('<path d="M5 12.5 10 17.5 19.5 7"/>'),
  sun: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>'),
  moon: SVG('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  info: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  note: SVG('<path d="M9 18.5a2.5 2.5 0 1 1-2.5-2.5H9V6l10-2v11.5a2.5 2.5 0 1 1-2.5-2.5H19V7.2L9 9.2z"/>', { fill: true }),
  alert: SVG('<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4.5M12 17.5v.5"/>'),
  menu: SVG('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  sparkle: SVG('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
} satisfies Record<string, string>

export function icon(name: IconName, cls?: string): string {
  const svg = ICONS[name]
  return cls ? svg.replace('<svg ', `<svg class="${cls}" `) : svg
}
