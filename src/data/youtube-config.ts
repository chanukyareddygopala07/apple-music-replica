/**
 * YouTube discovery configuration (Data API v3 + official IFrame embed).
 *
 * Discovery uses the free YouTube Data API v3 (`search.list`), which needs a
 * public API key from https://console.cloud.google.com (enable "YouTube Data
 * API v3"). Playback uses the official IFrame Player API embed — which needs
 * no key at all; the embed only loads when the user opens a video.
 *
 * The provider is enabled by default; it only becomes *configured* once an
 * API key is set, so credential-less builds show an "unconfigured" search
 * group and never call googleapis.
 *
 * No secret: VITE_* values are public build-time config embedded by Vite.
 * Restrict the key by HTTP referrer in Google Cloud (API restrictions).
 */

export interface YoutubeConfig {
  enabled: boolean
  apiKey: string
}

/** Only plain opt-out values disable the provider; empty/absent = enabled. */
const DISABLED = /^(0|false|no|off)$/i

/** Read a raw env shape (pure — unit-testable without import.meta.env). */
export function parseYoutubeConfig(raw: {
  enabled?: string
  apiKey?: string
}): YoutubeConfig {
  return {
    enabled: !DISABLED.test((raw.enabled ?? '').trim()),
    apiKey: (raw.apiKey ?? '').trim(),
  }
}

/** Literal import.meta.env reads so Vite bakes values at build time. */
export function readYoutubeConfig(): YoutubeConfig {
  return parseYoutubeConfig({
    enabled: import.meta.env.VITE_YOUTUBE_ENABLED as string | undefined,
    apiKey: import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined,
  })
}

export function isYoutubeConfigured(config: YoutubeConfig = readYoutubeConfig()): boolean {
  return config.enabled && config.apiKey.length > 0
}

export function describeYoutubeConfig(config: YoutubeConfig = readYoutubeConfig()): string {
  if (!config.enabled) {
    return 'Disabled (VITE_YOUTUBE_ENABLED=0). Embeds are off too.'
  }
  if (!config.apiKey) {
    return 'Needs a free API key: set VITE_YOUTUBE_API_KEY (YouTube Data API v3).'
  }
  return 'YouTube discovery enabled — API key set. Playback via the official embed.'
}
