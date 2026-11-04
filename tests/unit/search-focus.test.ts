import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Keyboard focus indicator for the shell's top search field (WCAG 2.4.7).
 *
 * `#top-search-input` historically suppressed the ring with `outline: none`
 * and nothing replaced it — the field received focus invisibly. These tests
 * pin the fix: a token-based, visible ring that cannot regress to `none`.
 */

const shellCss = readFileSync(join(process.cwd(), 'src/styles/shell.css'), 'utf8')
const baseCss = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8')

/** The declaration block of the first rule matching `selector`, or null. */
function ruleBody(css: string, selector: string): string | null {
  const at = css.indexOf(`${selector} {`)
  if (at === -1) return null
  const start = at + selector.length + 2
  const end = css.indexOf('}', start)
  return end === -1 ? null : css.slice(start, end)
}

describe('#top-search-input focus indicator', () => {
  it('draws a visible token-based ring instead of outline: none', () => {
    const body = ruleBody(shellCss, '.top-search input:focus-visible')
    expect(body, 'the focus-visible rule must exist in shell.css').not.toBeNull()
    expect(body).toMatch(/outline:\s*2px\s+solid\s+var\(--color-accent-fg\)/)
    expect(body).not.toMatch(/outline:\s*none/)
    // Offset keeps the ring off the underline border; no layout shift (outline).
    expect(body).toMatch(/outline-offset:\s*\d+px/)
    // Tokens rule: component CSS consumes variables, never raw hex.
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('keeps the global focus-visible fallback on the accent token', () => {
    const body = ruleBody(baseCss, ':focus-visible')
    expect(body, 'base.css must keep the global focus ring').not.toBeNull()
    expect(body).toMatch(/outline:\s*2px\s+solid\s+var\(--color-accent-fg\)/)
  })
})
