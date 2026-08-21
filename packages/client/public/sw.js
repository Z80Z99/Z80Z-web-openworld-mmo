const CACHE_NAME = "owmmo-v1";
const STATIC_CACHE = "owmmo-static-v1";
const API_CACHE = "owmmo-api-v1";

const STATIC_ASSETS = ["/", "/index.html", "/manifest.json", "/icons/icon-192.svg", "/icons/icon-512.svg"];

// Install: precache static shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: route by request type
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for API / WebSocket
  if (url.pathname.startsWith("/api") || request.headers.get("upgrade") === "websocket") {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for static assets
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback: return cached index.html for navigation
    if (request.mode === "navigate") {
      const cached = await caches.match("/index.html");
      if (cached) return cached;
    }
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}
