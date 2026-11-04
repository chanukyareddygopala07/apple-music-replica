import { describe, expect, it } from 'vitest'
import { WHITE_TEXT_MAX_LUMINANCE } from '@/utils/artwork'
import { applyHeroTheme } from '@/ui/media'

const lum = (rgb: [number, number, number]): number => {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Alpha-composite a white-ink text colour over a hex background (sRGB space). */
const ratioOn = (textAlpha: number, bgHex: string): number => {
  const bg = hexToRgb(bgHex)
  const text = bg.map((c) => textAlpha * 255 + (1 - textAlpha) * c) as [number, number, number]
  const [a, b] = [lum(text), lum(bg)]
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

describe('applyHeroTheme', () => {
  it('sets white ink and keeps both stops inside the white-text band', () => {
    const el = document.createElement('div')
    for (let i = 0; i < 96; i++) {
      applyHeroTheme(el, `seed-${i}`)
      expect(el.style.getPropertyValue('--hero-text')).toBe('rgba(255, 255, 255, 0.95)')
      expect(el.style.getPropertyValue('--hero-text-secondary')).toBe('rgba(255, 255, 255, 0.9)')
      for (const prop of ['--hero-from', '--hero-to'] as const) {
        const stop = el.style.getPropertyValue(prop)
        expect(stop).toMatch(/^#[0-9a-f]{6}$/)
        expect(lum(hexToRgb(stop))).toBeLessThanOrEqual(WHITE_TEXT_MAX_LUMINANCE + 1e-6)
        // Primary and secondary white ink must clear AA 4.5:1 on every stop.
        expect(ratioOn(0.95, stop)).toBeGreaterThanOrEqual(4.5)
        expect(ratioOn(0.9, stop)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
