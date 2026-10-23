import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerEngine } from '@/engine/player'
import type { Song } from '@/domain/types'

function song(id: string): Song {
  return {
    id,
    title: `Title ${id}`,
    albumId: 'al-x',
    artistIds: ['a-x'],
    durationMs: 180_000,
    trackNumber: 1,
    audioUrl: `https://example.com/${id}.mp3`,
  }
}

const SONGS = [song('s1'), song('s2'), song('s3'), song('s4')]

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as unknown as typeof HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.load = vi.fn() as unknown as typeof HTMLMediaElement.prototype.load
  HTMLMediaElement.prototype.pause = vi.fn() as unknown as typeof HTMLMediaElement.prototype.pause
})

describe('PlayerEngine queue', () => {
  it('starts a queue at the requested index', async () => {
    const p = new PlayerEngine()
    p.playQueue(SONGS, 1, { contextLabel: 'Test' })
    const snap = p.getSnapshot()
    expect(snap.queue).toHaveLength(4)
    expect(snap.index).toBe(1)
    expect(snap.currentSongId).toBe('s2')
    expect(snap.contextLabel).toBe('Test')
    await Promise.resolve()
    expect(p.getSnapshot().status).toBe('playing')
  })

  it('advances and wraps with manual next', () => {
    const p = new PlayerEngine()
    p.playQueue(SONGS, 3)
    p.next()
    expect(p.getSnapshot().index).toBe(0)
    p.previous()
    // previous at index 0 restarts current track
    expect(p.getSnapshot().index).toBe(0)
  })

  it('stops auto-advance at the end when repeat is off', () => {
    const p = new PlayerEngine()
    p.playQueue(SONGS, 3)
    p.next(true)
    expect(p.getSnapshot().index).toBe(3)
  })

  it('repeats all wraps on auto next', () => {
    const p = new PlayerEngine()
    p.setRepeat('all')
    p.playQueue(SONGS, 3)
    p.next(true)
    expect(p.getSnapshot().index).toBe(0)
  })

  it('enqueue appends to the upcoming queue', () => {
    const p = new PlayerEngine()
    p.playQueue(SONGS.slice(0, 2))
    p.enqueue(['s3', 's4'])
    expect(p.getSnapshot().queue.map((q) => q.songId)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('playNext inserts right after the current item', () => {
    const p = new PlayerEngine()
    p.playQueue(SONGS.slice(0, 2))
    p.enqueue(['s4'], { playNext: true })
    expect(p.getSnapshot().queue.map((q) => q.songId)).toEqual(['s1', 's4', 's2'])
  })

  it('removes a queue item by id', () => {
    const p = new PlayerEngine()
    p.playQueue(SONGS.slice(0, 3))
    const victim = p.getSnapshot().queue[2]!
    p.removeQueueItem(victim.queueItemId)
    expect(p.getSnapshot().queue.map((q) => q.songId)).toEqual(['s1', 's2'])
  })

  it('clears upcoming items but keeps the current one', () => {
    const p = new PlayerEngine()
    p.playQueue(SONGS, 1)
    p.clearUpcoming()
    expect(p.getSnapshot().queue.map((q) => q.songId)).toEqual(['s2'])
  })
})

describe('PlayerEngine shuffle / repeat', () => {
  it('shuffle keeps the start item first and restores base order when turned off', () => {
    const p = new PlayerEngine()
    p.setShuffle(true)
    p.playQueue(SONGS, 2)
    const snap = p.getSnapshot()
    expect(snap.queue[0]?.songId).toBe('s3')
    expect(new Set(snap.queue.map((q) => q.songId))).toEqual(new Set(['s1', 's2', 's3', 's4']))

    p.setShuffle(false)
    expect(p.getSnapshot().queue.map((q) => q.songId)).toEqual(['s1', 's2', 's3', 's4'])
    expect(p.getSnapshot().index).toBe(2)
  })

  it('cycles repeat modes off → all → one → off', () => {
    const p = new PlayerEngine()
    expect(p.cycleRepeat()).toBe('all')
    expect(p.cycleRepeat()).toBe('one')
    expect(p.cycleRepeat()).toBe('off')
  })
})

describe('PlayerEngine volume and restore', () => {
  it('clamps volume and toggles mute', () => {
    const p = new PlayerEngine()
    p.setVolume(2)
    expect(p.getSnapshot().volume).toBe(1)
    p.setVolume(-1)
    expect(p.getSnapshot().volume).toBe(0)
    p.setVolume(0.5)
    p.toggleMute()
    expect(p.getSnapshot().muted).toBe(true)
  })

  it('restores a session without autoplay', async () => {
    const p = new PlayerEngine()
    p.restore(SONGS, 2, 30_000, 'My Mix')
    const snap = p.getSnapshot()
    expect(snap.currentSongId).toBe('s3')
    expect(snap.index).toBe(2)
    expect(snap.contextLabel).toBe('My Mix')
    expect(snap.status).not.toBe('playing')
    await Promise.resolve()
    expect(p.getSnapshot().status).not.toBe('playing')
  })
})
