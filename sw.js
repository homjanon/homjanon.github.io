// 每部署一次更新版本号，旧缓存自动清理
const CACHE = 'invest-' + Date.now();
const OLD_PREFIX = 'invest-';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k.startsWith(OLD_PREFIX) && k !== CACHE)
            .map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const dest = e.request.destination;

  // HTML 主页面：Network-Only，永不缓存
  if (dest === 'document') {
    // no-op: let browser handle normally, SW doesn't intervene
    return;
  }

  // 静态资源 (CSS/JS/本地文件)：Network-First，失败时降级缓存
  if (dest === 'style' || dest === 'script' || url.pathname.match(/\.(css|js|png|jpg|svg|ico)$/i)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // API 数据请求和外部 CDN：Stale-While-Revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
