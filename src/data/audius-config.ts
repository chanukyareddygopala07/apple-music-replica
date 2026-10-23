/**
 * Audius (free, public API) configuration.
 *
 * Audius is the primary external catalogue/streaming provider and is ON by
 * default: anonymous access works without credentials (the optional
 * VITE_AUDIUS_API_KEY is sent as an `api_key` query parameter, the transport
 * the official Audius SDK itself uses in the browser). Disable explicitly
 * with VITE_AUDIUS_ENABLED=0 (or false/no/off) to force demo-only mode.
 *
 * No paid dependency and no secret: only VITE_* public build-time values.
 */

export interface AudiusConfig {
  enabled: boolean
  apiKey: string
}

/** Only plain opt-out values disable the provider; empty/absent = enabled. */
const DISABLED = /^(0|false|no|off)$/i

/** Read a raw env shape (pure — unit-testable without import.meta.env). */
export function parseAudiusConfig(raw: {
  enabled?: string
  apiKey?: string
}): AudiusConfig {
  const enabled = !DISABLED.test((raw.enabled ?? '').trim())
  return {
    enabled,
    apiKey: (raw.apiKey ?? '').trim(),
  }
}

/** Literal import.meta.env reads so Vite bakes values at build time. */
export function readAudiusConfig(): AudiusConfig {
  return parseAudiusConfig({
    enabled: import.meta.env.VITE_AUDIUS_ENABLED as string | undefined,
    apiKey: import.meta.env.VITE_AUDIUS_API_KEY as string | undefined,
  })
}

export function isAudiusConfigured(config: AudiusConfig = readAudiusConfig()): boolean {
  return config.enabled
}

export function describeAudiusConfig(config: AudiusConfig = readAudiusConfig()): string {
  if (!config.enabled) {
    return 'Disabled (VITE_AUDIUS_ENABLED=0). The demo catalogue only.'
  }
  return config.apiKey
    ? 'Audius (free) enabled — API key set.'
    : 'Audius (free) enabled — anonymous access.'
}
