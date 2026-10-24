/**
 * Jamendo (free, Creative Commons catalogue) configuration.
 *
 * Jamendo's read API is free but requires an application `client_id` from
 * https://devportal.jamendo.com (accept their API terms). The provider is
 * enabled by default; it only becomes *configured* once a client id is set,
 * so credential-less builds simply show an "unconfigured" search group and
 * never make a request.
 *
 * No paid dependency and no secret: VITE_* values are public build-time
 * config baked into the bundle by Vite.
 */

export interface JamendoConfig {
  enabled: boolean
  clientId: string
}

/** Only plain opt-out values disable the provider; empty/absent = enabled. */
const DISABLED = /^(0|false|no|off)$/i

/** Read a raw env shape (pure — unit-testable without import.meta.env). */
export function parseJamendoConfig(raw: {
  enabled?: string
  clientId?: string
}): JamendoConfig {
  return {
    enabled: !DISABLED.test((raw.enabled ?? '').trim()),
    clientId: (raw.clientId ?? '').trim(),
  }
}

/** Literal import.meta.env reads so Vite bakes values at build time. */
export function readJamendoConfig(): JamendoConfig {
  return parseJamendoConfig({
    enabled: import.meta.env.VITE_JAMENDO_ENABLED as string | undefined,
    clientId: import.meta.env.VITE_JAMENDO_CLIENT_ID as string | undefined,
  })
}

export function isJamendoConfigured(config: JamendoConfig = readJamendoConfig()): boolean {
  return config.enabled && config.clientId.length > 0
}

export function describeJamendoConfig(config: JamendoConfig = readJamendoConfig()): string {
  if (!config.enabled) {
    return 'Disabled (VITE_JAMENDO_ENABLED=0).'
  }
  if (!config.clientId) {
    return 'Needs a free client id: set VITE_JAMENDO_CLIENT_ID (devportal.jamendo.com).'
  }
  return 'Jamendo (free CC catalogue) enabled — client id set.'
}
