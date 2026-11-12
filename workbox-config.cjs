/**
 * Workbox Configuration for ATMOS PWA
 * Generates service worker with precaching and runtime caching strategies
 */

module.exports = {
  globDirectory: 'dist/',
  globPatterns: [
    'index.html',
    'app.js',
    'engine.js',
    'style.css',
    'benchmark.json',
    'health.json',
    'status.html',
  ],
  globIgnores: [
    '*.map',
    '*.txt',
  ],
  swDest: 'dist/sw.js',
  maximumFileSizeToCacheInBytes: 50 * 1024 * 1024, // 50MB
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/api\.open-meteo\.com\/v1\/forecast/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'open-meteo-forecast',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 24 * 60 * 60, // 24 hours
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/archive-api\.open-meteo\.com\/v1\/archive/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'open-meteo-archive',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/air-quality-api\.open-meteo\.com\/v1\/air-quality/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'open-meteo-air-quality',
        expiration: {
          maxEntries: 20,
          maxAgeSeconds: 60 * 60, // 1 hour
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/flood-api\.open-meteo\.com\/v1\/flood/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'open-meteo-flood',
        expiration: {
          maxEntries: 20,
          maxAgeSeconds: 3 * 60 * 60, // 3 hours
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'open-meteo-geocoding',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/api\.rainviewer\.com\/public\/weather-maps\.json/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'rainviewer-maps',
        expiration: {
          maxEntries: 5,
          maxAgeSeconds: 10 * 60, // 10 minutes
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\//,
      handler: 'CacheFirst',
      options: {
        cacheName: 'rainviewer-tiles',
        expiration: {
          maxEntries: 200,
          maxAgeSeconds: 30 * 60, // 30 minutes
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/www\.gdacs\.org\/gdacsapi\/api\/events\/geteventlist/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'gdacs-events',
        expiration: {
          maxEntries: 20,
          maxAgeSeconds: 15 * 60, // 15 minutes
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'leaflet-css',
        expiration: {
          maxEntries: 1,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'leaflet-js',
        expiration: {
          maxEntries: 1,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/css2/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-css',
        expiration: {
          maxEntries: 5,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-webfonts',
        expiration: {
          maxEntries: 30,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    {
      urlPattern: /^https:\/\/{s}\.tile\.openstreetmap\.org\//,
      handler: 'CacheFirst',
      options: {
        cacheName: 'openstreetmap-tiles',
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
  ],
};