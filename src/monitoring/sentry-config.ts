/**
 * Sentry Configuration for ATMOS
 * Load from environment variables or use defaults
 */

export interface SentryEnvConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
  enableTracing: boolean;
  enableProfiling: boolean;
  debug: boolean;
}

/** Get Sentry configuration from environment */
export function getSentryConfig(): SentryConfig {
  return {
    dsn: import.meta.env.VITE_SENTRY_DSN || '',
    environment: import.meta.env.MODE || 'development',
    release: import.meta.env.VITE_APP_VERSION || '1.0.0',
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE) || 0.1,
    profilesSampleRate: Number(import.meta.env.VITE_SENTRY_PROFILES_RATE) || 0,
    enableTracing: import.meta.env.VITE_SENTRY_TRACING !== 'false',
    enableProfiling: import.meta.env.VITE_SENTRY_PROFILING === 'true',
    debug: import.meta.env.DEV,
  };
}

/** Sentry configuration type */
export interface SentryConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
  enableTracing: boolean;
  enableProfiling: boolean;
  debug: boolean;
}