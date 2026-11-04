import { describe, expect, it, vi } from 'vitest'
import { createSlider } from '@/ui/slider'

describe('createSlider accessibility', () => {
  it('labels the range input and sets default percent valuetext', () => {
    const handle = createSlider({ value: 0.5, label: 'Volume', onChange: vi.fn() })
    const input = handle.el.querySelector('input')
    expect(input).toBeTruthy()
    expect(input?.getAttribute('aria-label')).toBe('Volume')
    expect(input?.getAttribute('aria-valuetext')).toBe('50%')
    expect(input?.getAttribute('type')).toBe('range')
    expect(input?.getAttribute('min')).toBe('0')
    expect(input?.getAttribute('max')).toBe('1000')
  })

  it('uses formatValue for aria-valuetext on input events', () => {
    const onChange = vi.fn()
    const handle = createSlider({
      value: 0,
      label: 'Seek',
      formatValue: (v) => `${Math.round(v * 100)}% of track`,
      onChange,
    })
    const input = handle.el.querySelector('input')!
    expect(input.getAttribute('aria-valuetext')).toBe('0% of track')

    input.value = '250'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith(0.25, { commit: false })
    expect(input.getAttribute('aria-valuetext')).toBe('25% of track')

    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith(0.25, { commit: true })
  })

  it('updates aria-valuetext from setValue but not while the input is focused', () => {
    const handle = createSlider({ value: 0, label: 'Volume', onChange: vi.fn() })
    document.body.appendChild(handle.el)
    const input = handle.el.querySelector('input')!

    handle.setValue(0.8)
    expect(input.getAttribute('aria-valuetext')).toBe('80%')
    expect(handle.el.querySelector('.fill')?.getAttribute('style')).toContain('width: 80%')

    input.focus()
    handle.setValue(0.2)
    expect(input.getAttribute('aria-valuetext')).toBe('80%')
    expect(input.value).toBe('800')
    handle.el.remove()
  })

  it('clamps out-of-range values', () => {
    const handle = createSlider({ value: 0.5, label: 'Volume', onChange: vi.fn() })
    handle.setValue(2)
    const input = handle.el.querySelector('input')!
    expect(input.value).toBe('1000')
    expect(input.getAttribute('aria-valuetext')).toBe('100%')
  })

  it('marks the visual track decorative and disables via setEnabled', () => {
    const handle = createSlider({ value: 1, label: 'Seek', onChange: vi.fn() })
    expect(handle.el.querySelector('.track')?.getAttribute('aria-hidden')).toBe('true')
    handle.setEnabled(false)
    expect(handle.el.querySelector('input')?.disabled).toBe(true)
    handle.setEnabled(true)
    expect(handle.el.querySelector('input')?.disabled).toBe(false)
  })

  it('pointerdown on the track seeks (pointer interaction)', () => {
    const onChange = vi.fn()
    const handle = createSlider({ value: 0, label: 'Seek', onChange })
    handle.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON: () => ({}) })

    const down = new PointerEvent('pointerdown', { clientX: 50, bubbles: true })
    handle.el.dispatchEvent(down)
    expect(onChange).toHaveBeenCalledWith(0.5, { commit: false })

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith(0.5, { commit: true })
  })
})
