import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === 'production',

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Disable for server-side replays (not useful)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
