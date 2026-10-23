import { describe, expect, it } from 'vitest'
import { formatTime, formatDurationLong, formatSongCount, formatDate, formatRelative } from '@/utils/format'

describe('formatTime', () => {
  it('formats minutes and padded seconds', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9_000)).toBe('0:09')
    expect(formatTime(61_000)).toBe('1:01')
    expect(formatTime(372_000)).toBe('6:12')
  })

  it('guards invalid values', () => {
    expect(formatTime(-5)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})

describe('formatDurationLong', () => {
  it('uses minutes under an hour', () => {
    expect(formatDurationLong(30 * 60_000)).toBe('30 minutes')
    expect(formatDurationLong(60_000)).toBe('1 minute')
  })

  it('uses hours at 60+ minutes', () => {
    expect(formatDurationLong(60 * 60_000)).toBe('1 hour')
    expect(formatDurationLong(90 * 60_000)).toBe('1 hour, 30 minutes')
    expect(formatDurationLong(120 * 60_000)).toBe('2 hours')
  })
})

describe('formatSongCount', () => {
  it('pluralises correctly', () => {
    expect(formatSongCount(0)).toBe('0 songs')
    expect(formatSongCount(1)).toBe('1 song')
    expect(formatSongCount(12)).toBe('12 songs')
  })
})

describe('formatDate', () => {
  it('formats ISO dates', () => {
    expect(formatDate('2026-08-14')).toBe('14 August 2026')
  })

  it('returns the input when unparseable', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatRelative', () => {
  it('describes recent timestamps', () => {
    const now = Date.now()
    expect(formatRelative(now)).toBe('Just now')
    expect(formatRelative(now - 5 * 60_000)).toBe('5m ago')
    expect(formatRelative(now - 3 * 3_600_000)).toBe('3h ago')
    expect(formatRelative(now - 2 * 86_400_000)).toBe('2d ago')
  })
})
