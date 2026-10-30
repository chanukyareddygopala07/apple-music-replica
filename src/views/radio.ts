/** Radio view — demo stations built from the catalogue. */

import { getCatalog } from '@/data/catalog-helpers'
import { artImg, attachArtworkFallback } from '@/ui/el'
import { icon } from '@/ui/icons'
import { sectionHeaderHtml } from '@/ui/media'
import { gradientCss } from '@/utils/artwork'

export async function renderRadio(root: HTMLElement): Promise<void> {
  root.innerHTML = `<h1 class="page-title">Radio</h1>`
  const stations = await getCatalog().getStations()

  const cards = stations
    .map(
      (s) => `
      <article class="station-card" style="background:${gradientCss(s.artworkSeed)}">
        <span class="live-badge"><span class="live-dot" aria-hidden="true"></span>On Air</span>
        <div class="st-shade" aria-hidden="true"></div>
        <h3 class="st-title">${s.name.replaceAll('<', '&lt;')}</h3>
        <p class="st-sub">${s.description.replaceAll('<', '&lt;')}</p>
        <button type="button" class="play-circle st-play" data-action="play-context" data-kind="station" data-id="${s.id}" aria-label="Play ${s.name.replaceAll('"', '')}">${icon('play')}</button>
      </article>`,
    )
    .join('')

  root.innerHTML = `
    <h1 class="page-title">Radio</h1>
    <p class="page-subtitle">Demo stations spin endless sets from the Realaxify catalogue. (Live broadcasts aren’t part of the demo.)</p>
    ${sectionHeaderHtml('Stations')}
    <div class="station-grid">${cards}</div>
  `
  attachArtworkFallback(root)
  void artImg
}
