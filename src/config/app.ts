/**
 * Global app identity. Rename the whole product by changing these constants
 * (plus the PWA manifest strings in vite.config.ts, which read from here).
 */
export const APP_CONFIG = {
  name: 'LIFEFORGE',
  displayName: 'LifeForge',
  shortName: 'LifeForge',
  tagline: 'Your real life is the game.',
  version: '1.0.0',
  dbName: 'lifeforge',
  /** Bump when the export format changes in a non-backward-compatible way. */
  exportFormatVersion: 1,
} as const;

export type AppConfig = typeof APP_CONFIG;
