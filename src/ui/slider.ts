/**
 * Accessible slider (progress + volume).
 * Visual fill is a div; semantics + keyboard come from a hidden range input.
 */

import { qs } from '@/ui/el'

export interface SliderOptions {
  value: number // 0..1
  label: string
  onChange: (value: number, opts: { commit: boolean }) => void
  accent?: boolean
  formatValue?: (value: number) => string
}

export interface SliderHandle {
  el: HTMLElement
  setValue(value: number): void
  setEnabled(enabled: boolean): void
}

export function createSlider(opts: SliderOptions): SliderHandle {
  const el = document.createElement('div')
  el.className = `slider${opts.accent ? ' accent' : ''}`
  el.innerHTML = `
    <div class="track" aria-hidden="true"><div class="fill" style="width:${Math.round(opts.value * 100)}%"></div></div>
    <input type="range" min="0" max="1000" step="1" value="${Math.round(opts.value * 1000)}" aria-label="" />`
  const input = qs<HTMLInputElement>('input', el)
  const fill = qs<HTMLElement>('.fill', el)
  if (input) input.setAttribute('aria-label', opts.label)

  const emit = (commit: boolean) => {
    if (!input || !fill) return
    const v = Number(input.value) / 1000
    fill.style.width = `${Math.round(v * 100)}%`
    opts.onChange(v, { commit })
  }

  input?.addEventListener('input', () => emit(false))
  input?.addEventListener('change', () => emit(true))
  // Pointer drag on the visual track
  const pointerToValue = (ev: PointerEvent): number => {
    const rect = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
  }
  el.addEventListener('pointerdown', (ev) => {
    if (!input) return
    if (ev.target === input) return
    ev.preventDefault()
    const v = pointerToValue(ev)
    input.value = String(Math.round(v * 1000))
    emit(false)
    const move = (e: PointerEvent) => {
      const v2 = pointerToValue(e)
      input.value = String(Math.round(v2 * 1000))
      emit(false)
    }
    const up = () => {
      emit(true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })

  return {
    el,
    setValue(value: number) {
      if (!input || !fill) return
      const v = Math.min(1, Math.max(0, value))
      if (document.activeElement === input) return // don't fight the user mid-drag
      input.value = String(Math.round(v * 1000))
      fill.style.width = `${Math.round(v * 100)}%`
    },
    setEnabled(enabled: boolean) {
      if (!input) return
      input.disabled = !enabled
      el.style.opacity = enabled ? '1' : '0.45'
    },
  }
}
