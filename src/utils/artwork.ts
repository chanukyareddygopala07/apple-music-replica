/**
 * Deterministic generated artwork (original, no external assets).
 * Each seed maps to a stable duotone cover rendered as an inline SVG.
 */

const PALETTES: Array<[string, string, string]> = [
  // [from, to, ink]
  ['#7b2ff7', '#f107a3', '#ffffff'],
  ['#0f2027', '#2c5364', '#e0f7fa'],
  ['#ff512f', '#dd2476', '#fff8e7'],
  ['#11998e', '#38ef7d', '#0b3d2e'],
  ['#396afc', '#2948ff', '#ffffff'],
  ['#8e2de2', '#4a00e0', '#ffe9a8'],
  ['#f83600', '#f9d423', '#2b1a00'],
  ['#1f4037', '#99f2c8', '#0b2b22'],
  ['#654ea3', '#eaafc8', '#2a1030'],
  ['#00c6ff', '#0072ff', '#eef6ff'],
  ['#e96443', '#904e95', '#ffe6d9'],
  ['#141e30', '#243b55', '#9fb8d8'],
  ['#fc466b', '#3f5efb', '#ffffff'],
  ['#41295a', '#2f0743', '#e8d5ff'],
]

type Pattern = 'circles' | 'stripes' | 'wave' | 'grid' | 'diag' | 'orb' | 'split' | 'peaks'

const PATTERNS: Pattern[] = ['circles', 'stripes', 'wave', 'grid', 'diag', 'orb', 'split', 'peaks']

/** Small deterministic PRNG (xmur3 + mulberry32). */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function patternSvg(pattern: Pattern, to: string, ink: string, rand: () => number): string {
  switch (pattern) {
    case 'circles': {
      const shapes = Array.from({ length: 5 }, (_, i) => {
        const cx = 100 + rand() * 400
        const cy = 100 + rand() * 400
        const r = 40 + rand() * (120 - i * 12)
        return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${ink}" opacity="${(0.08 + i * 0.05).toFixed(2)}"/>`
      }).join('')
      return shapes
    }
    case 'stripes': {
      const n = 9
      return Array.from({ length: n }, (_, i) => {
        const x = (i * 600) / n
        const w = 14 + rand() * 40
        return `<rect x="${x.toFixed(0)}" y="0" width="${w.toFixed(0)}" height="600" fill="${ink}" opacity="${(0.07 + rand() * 0.14).toFixed(2)}"/>`
      }).join('')
    }
    case 'wave': {
      let d = 'M0 420'
      for (let x = 0; x <= 600; x += 40) {
        d += ` Q ${x + 20} ${300 + rand() * 220}, ${x + 40} ${340 + rand() * 120}`
      }
      d += ' L600 600 L0 600 Z'
      return `<path d="${d}" fill="${ink}" opacity="0.22"/><path d="${d}" transform="translate(0 -120)" fill="${ink}" opacity="0.12"/>`
    }
    case 'grid': {
      const dots: string[] = []
      for (let x = 60; x < 600; x += 70) {
        for (let y = 60; y < 600; y += 70) {
          const r = 3 + rand() * 10
          dots.push(`<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${ink}" opacity="${(0.1 + rand() * 0.2).toFixed(2)}"/>`)
        }
      }
      return dots.join('')
    }
    case 'diag': {
      return Array.from({ length: 12 }, (_, i) => {
        const off = i * 70 - 300
        return `<line x1="${off}" y1="600" x2="${off + 420}" y2="0" stroke="${ink}" stroke-width="${(6 + rand() * 22).toFixed(0)}" opacity="${(0.06 + rand() * 0.12).toFixed(2)}"/>`
      }).join('')
    }
    case 'orb': {
      const cx = 180 + rand() * 240
      const cy = 200 + rand() * 200
      return [
        `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="190" fill="${ink}" opacity="0.20"/>`,
        `<circle cx="${(cx + 60).toFixed(0)}" cy="${(cy - 40).toFixed(0)}" r="110" fill="${to}" opacity="0.85"/>`,
        `<circle cx="${(cx + 20).toFixed(0)}" cy="${(cy - 10).toFixed(0)}" r="52" fill="${ink}" opacity="0.5"/>`,
      ].join('')
    }
    case 'split': {
      const y = 160 + rand() * 260
      return `<rect x="0" y="${y.toFixed(0)}" width="600" height="${(600 - y).toFixed(0)}" fill="${ink}" opacity="0.16"/><circle cx="${(120 + rand() * 360).toFixed(0)}" cy="${(y - 40).toFixed(0)}" r="86" fill="${ink}" opacity="0.28"/>`
    }
    case 'peaks': {
      let d = 'M0 600'
      let y = 320
      for (let x = 0; x <= 600; x += 75) {
        y = 180 + rand() * 260
        d += ` L ${x + 37} ${y.toFixed(0)} L ${x + 75} ${(240 + rand() * 160).toFixed(0)}`
      }
      d += ' L600 600 Z'
      return `<path d="${d}" fill="${ink}" opacity="0.2"/>`
    }
  }
}

export function artworkDataUrl(seed: string, opts?: { round?: boolean }): string {
  const h = hashSeed(seed || 'sonora')
  const rand = mulberry32(h)
  const pal = PALETTES[h % PALETTES.length]!
  const [from, to, ink] = pal
  const pattern = PATTERNS[(h >>> 8) % PATTERNS.length]!
  const angle = 25 + Math.floor(rand() * 120)
  const shapes = patternSvg(pattern, to, ink, rand)
  const radius = opts?.round ? 300 : 28
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<defs>
<linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">
<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
</linearGradient>
<radialGradient id="v" cx="0.5" cy="0.42" r="0.75">
<stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/>
</radialGradient>
<clipPath id="c"><rect x="0" y="0" width="600" height="600" rx="${radius}" ry="${radius}"/></clipPath>
</defs>
<g clip-path="url(#c)">
<rect width="600" height="600" fill="url(#g)"/>
${shapes}
<rect width="600" height="600" fill="url(#v)"/>
</g>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Two-stop gradient (for editorial cards / category washes). */
export function gradientCss(seed: string): string {
  const h = hashSeed(seed || 'sonora')
  const [from, to] = PALETTES[h % PALETTES.length]!
  return `linear-gradient(135deg, ${from}, ${to})`
}

/** Hero page colours derived from a seed (album/artist/playlist theming).
 * Uses the same palette index as artworkDataUrl so heroes match their art. */
export function heroColors(seed: string): { from: string; to: string } {
  const h = hashSeed(seed || 'sonora')
  const [from, to] = PALETTES[h % PALETTES.length]!
  return { from, to }
}
