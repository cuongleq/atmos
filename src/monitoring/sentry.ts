import * as Sentry from '@sentry/browser';
import { BrowserTracing } from '@sentry/tracing';

export interface SentryConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
  debug: boolean;
  ignoreErrors?: string[];
  ignoreTransactions?: string[];
}

function makeBeforeSend(config: { ignoreErrors?: string[] }) {
  return (event: any, hint: any) => {
    if (config.ignoreErrors) {
      const error = hint.originalException;
      if (error instanceof Error) {
        for (const ignored of config.ignoreErrors) {
          if (error.message.includes(ignored)) return null;
        }
      }
    }
    event.contexts = {
      ...event.contexts,
      app: { name: 'ATMOS', version: config.release },
      user: {},
    };
    return event;
  };
}

function makeBeforeSendTransaction(config: { ignoreTransactions?: string[] }) {
  return (transaction: any) => {
    if (config.ignoreTransactions) {
      for (const ignored of config.ignoreTransactions) {
        if (transaction.transaction?.includes(ignored)) return null;
      }
    }
    return transaction;
  };
}

export function initSentry(config: {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
  debug: boolean;
  ignoreErrors?: string[];
  ignoreTransactions?: string[];
}): void {
  if (!config.dsn) {
    console.warn('[Sentry] No DSN provided, error tracking disabled');
    return;
  }

  const bs = (event: any, hint: any) => {
    if (config.ignoreErrors) {
      const error = hint.originalException;
      if (error instanceof Error) {
        for (const ignored of config.ignoreErrors) {
          if (error.message.includes(ignored)) return null;
        }
      }
      event.contexts = {
        ...event.contexts,
        app: { name: 'ATMOS', version: config.release },
        user: {},
      };
      return event;
    };
  };

  const bst = (transaction: any) => {
    if (config.ignoreTransactions) {
      for (const ignored of config.ignoreTransactions) {
        if (transaction.transaction?.includes(ignored)) return null;
      }
    }
    return transaction;
  };

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    profilesSampleRate: config.profilesSampleRate,
    debug: config.debug,
    integrations: [new Sentry.BrowserTracing({ tracingOrigins: ['localhost', /^\//, /^https:\/\/api\.open-meteo\.com/], trackComponents: true })],
    beforeSend: bs,
    beforeSendTransaction: bst,
    fingerprint: ['{{ default }}'],
  });

  setupGlobalHandlers();
  console.log('[Sentry] Initialized for environment:', config.environment);
}

function setupGlobalHandlers(): void {
  window.addEventListener('unhandledrejection', (event) => {
    Sentry.captureException(event.reason, { mechanism: { handled: false, type: 'unhandledrejection' } });
  });
  window.addEventListener('error', (event) => {
    Sentry.captureException(event.error, { mechanism: { handled: false, type: 'onerror' } });
  });
}

export function setUserContext(user: { id: string; email?: string; username?: string; ip_address?: string }): void { Sentry.setUser(user); }
export function clearUserContext(): void { Sentry.setUser(null); }
export function addBreadcrumb(category: string, message: string, level = 'info', data?: Record<string, unknown>): void { Sentry.addBreadcrumb({ category, message, level, data, timestamp: Date.now() / 1000 }); }
export function startTransaction(name: string, op: string, tags?: Record<string, string>): any { return Sentry.startTransaction({ name, op, tags }); }
export function captureException(error: Error | unknown, context?: Record<string, unknown>): string { return Sentry.captureException(error, { extra: context }); }
export function captureMessage(message: string, level = 'info', context?: Record<string, unknown>): string { return Sentry.captureMessage(message, level, { extra: context }); }
export function setTags(tags: Record<string, string>): void { Object.entries(tags).forEach(([key, value]) => Sentry.setTag(key, value)); }
export function setExtras(extras: Record<string, unknown>): void { Object.entries(extras).forEach(([key, value]) => Sentry.setExtra(key, value)); }
export function getSentry(): typeof Sentry { return Sentry; }
export function isSentryInitialized(): boolean { return Sentry.getCurrentHub().getClient() !== undefined; }
export function flushSentry(timeout = 2000): Promise<boolean> { return Sentry.flush(timeout); }

function initializeClient(): void {
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      flushSentry(1000);
    });
  }
}

initializeClient();

export const __sentry_module_loaded = true;