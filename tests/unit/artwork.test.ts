import { describe, expect, it } from 'vitest'
import {
  WHITE_TEXT_MAX_LUMINANCE,
  artworkDataUrl,
  clampedGradientCss,
  fitForWhiteText,
  gradientCss,
  heroColors,
} from '@/utils/artwork'

const luminance = (hex: string): number => {
  const n = parseInt(hex.replace('#', ''), 16)
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  )
}

describe('artworkDataUrl', () => {
  it('is deterministic per seed', () => {
    expect(artworkDataUrl('album-al-x')).toBe(artworkDataUrl('album-al-x'))
    expect(artworkDataUrl('album-al-x')).not.toBe(artworkDataUrl('album-al-y'))
  })

  it('returns an svg data url with a rounded clip', () => {
    const url = artworkDataUrl('seed-1')
    expect(url.startsWith('data:image/svg+xml')).toBe(true)
    expect(url).toContain('clipPath')
  })

  it('supports round crops', () => {
    expect(artworkDataUrl('seed-1', { round: true })).not.toBe(artworkDataUrl('seed-1'))
  })
})

describe('heroColors / gradientCss', () => {
  it('produces a from/to pair for any seed', () => {
    const { from, to } = heroColors('album-al-tidal-lines')
    expect(from).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(to).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(from).not.toBe(to)
  })

  it('builds a css gradient', () => {
    expect(gradientCss('anything')).toContain('linear-gradient')
  })
})

describe('fitForWhiteText / clampedGradientCss', () => {
  it('keeps colours already inside the white-text band unchanged', () => {
    expect(fitForWhiteText('#1f4037')).toBe('#1f4037')
    expect(fitForWhiteText('#0f2027')).toBe('#0f2027')
  })

  it('darkens bright colours to at or below the band, preserving hue', () => {
    const bright = ['#99f2c8', '#00c6ff', '#f9d423', '#f107a3', '#38ef7d']
    const hue = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16)
      const r = (n >> 16) & 0xff
      const g = (n >> 8) & 0xff
      const b = n & 0xff
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const d = mx - mn
      if (!d) return 0
      let h: number
      if (mx === r) h = ((g - b) / d) % 6
      else if (mx === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      return ((h * 60) + 360) % 360
    }
    for (const hex of bright) {
      const out = fitForWhiteText(hex)
      expect(out).toMatch(/^#[0-9a-f]{6}$/)
      expect(luminance(out)).toBeLessThanOrEqual(WHITE_TEXT_MAX_LUMINANCE + 1e-6)
      expect(Math.abs(hue(out) - hue(hex))).toBeLessThan(3)
    }
  })

  it('is idempotent', () => {
    for (const hex of ['#99f2c8', '#00c6ff', '#1f4037']) {
      const once = fitForWhiteText(hex)
      expect(fitForWhiteText(once)).toBe(once)
    }
  })

  it('clamps every palette stop reached by clampedGradientCss', () => {
    for (let i = 0; i < 64; i++) {
      const gradient = clampedGradientCss(`seed-${i}`)
      expect(gradient).toContain('linear-gradient')
      const stops = gradient.match(/#[0-9a-f]{6}/g) ?? []
      expect(stops.length).toBe(2)
      for (const stop of stops) {
        expect(luminance(stop)).toBeLessThanOrEqual(WHITE_TEXT_MAX_LUMINANCE + 1e-6)
      }
    }
  })
})
