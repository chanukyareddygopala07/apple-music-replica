import { describe, expect, it } from 'vitest'
import { artworkDataUrl, gradientCss, heroColors } from '@/utils/artwork'

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
