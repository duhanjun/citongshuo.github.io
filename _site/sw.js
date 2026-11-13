/* ===========================================================
 * sw.js
 * ===========================================================
 * Copyright 2016 @huxpro
 * Licensed under Apache 2.0
 * service worker scripting
 * ========================================================== */

// CACHE_NAMESPACE
// CacheStorage is shared between all sites under same domain.
// A namespace can prevent potential name conflicts and mis-deletion.
const CACHE_NAMESPACE = 'main-'
// 每次构建生成新的版本号：发布后旧 cache 在 activate 阶段被删除，
// 避免 CacheStorage 里的旧 CSS/JS 在新 HTML 下继续被 SWR 优先返回。
const CACHE_VERSION = '20261113220312';
const CACHE = CACHE_NAMESPACE + 'precache-then-runtime-' + CACHE_VERSION;
const PRECACHE_LIST = [
  "./",
  "./offline.html",
  "./js/jquery.min.js",
  "./js/bootstrap.min.js",
  "./js/hux-blog.min.js",
  "./js/snackbar.js",
  "./js/citongshuo.js",
  "./img/icon_wechat.png",
  "./img/home-bg.jpg",
  "./img/home-bg-1280.webp",
  "./img/cover-community-1280.webp",
  "./css/hux-blog.min.css",
  "./css/bootstrap.min.css",
  "./css/citongshuo.css",
  "./css/font-awesome.min.css",
  "./fonts/fontawesome-webfont.woff2"
]
const HOSTNAME_WHITELIST = [
  self.location.hostname
]
const DEPRECATED_CACHES = ['precache-v1', 'runtime', 'main-precache-v1', 'main-runtime']


// The Util Function to hack URLs of intercepted requests
const getCacheBustingUrl = (req) => {
  var now = Date.now();
  const url = new URL(req.url)

  // 1. fixed http URL
  // Just keep syncing with location.protocol
  // fetch(httpURL) belongs to active mixed content.
  // And fetch(httpRequest) is not supported yet.
  url.protocol = self.location.protocol

  // 2. add query for caching-busting.
  // Github Pages served with Cache-Control: max-age=600
  // max-age on mutable content is error-prone, with SW life of bugs can even extend.
  // Until cache mode of Fetch API landed, we have to workaround cache-busting with query string.
  // Cache-Control-Bug: https://bugs.chromium.org/p/chromium/issues/detail?id=453190
  url.search += (url.search ? '&' : '?') + 'cache-bust=' + now;
  return url.href
}

// The Util Function to detect and polyfill req.mode="navigate"
// request.mode of 'navigate' is unfortunately not supported in Chrome
// versions older than 49, so we need to include a less precise fallback,
// which checks for a GET request with an Accept: text/html header.
const isNavigationReq = (req) => {
  const accept = req.headers.get('accept') || ''
  return req.mode === 'navigate' || (req.method === 'GET' && accept.includes('text/html'))
}

// The Util Function to detect if a req is end with extension
// Accordin to Fetch API spec <https://fetch.spec.whatwg.org/#concept-request-destination>
// Any HTML's navigation has consistently mode="navigate" type="" and destination="document"
// including requesting an img (or any static resources) from URL Bar directly.
// So It ends up with that regExp is still the king of URL routing ;)
// P.S. An url.pathname has no '.' can not indicate it ends with extension (e.g. /api/version/1.2/)
const endWithExtension = (req) => Boolean(new URL(req.url).pathname.match(/\.\w+$/))

// Redirect in SW manually fixed github pages arbitray 404s on things?blah
// what we want:
//    repo?blah -> !(gh 404) -> sw 302 -> repo/?blah
//    .ext?blah -> !(sw 302 -> .ext/?blah -> gh 404) -> .ext?blah
// If It's a navigation req and it's url.pathname isn't end with '/' or '.ext'
// it should be a dir/repo request and need to be fixed (a.k.a be redirected)
// Tracking https://twitter.com/Huxpro/status/798816417097224193
const shouldRedirect = (req) => (isNavigationReq(req) && new URL(req.url).pathname.substr(-1) !== "/" && !endWithExtension(req))

// The Util Function to get redirect URL
// `${url}/` would mis-add "/" in the end of query, so we use URL object.
// P.P.S. Always trust url.pathname instead of the whole url string.
const getRedirectUrl = (req) => {
  const url = new URL(req.url)
  url.pathname += "/"
  return url.href
}


/**
 *  @Lifecycle Install
 *  Precache anything static to this version of your app.
 *  e.g. App Shell, 404, JS/CSS dependencies...
 *
 *  waitUntil() : installing ====> installed
 *  skipWaiting() : waiting(installed) ====> activating
 */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // 逐项缓存：单个资源 404 不会让整批回滚；失败只记录，其余资源仍可离线使用。
      .then(cache => Promise.all(PRECACHE_LIST.map(url =>
        cache.add(url).catch(err => console.log('precache failed:', url, err))
      )))
      .then(() => self.skipWaiting())
  )
});


/**
 *  @Lifecycle Activate
 *  New one activated when old isnt being used.
 *
 *  waitUntil(): activating ====> activated
 */
self.addEventListener('activate', event => {
  // 删除旧版本 cache：所有 main- 前缀但非当前版本，以及历史遗留名称。
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => (cacheName.startsWith(CACHE_NAMESPACE) && cacheName !== CACHE) ||
            DEPRECATED_CACHES.includes(cacheName))
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  )
  console.log('service worker activated:', CACHE_VERSION)
});


/**
 *  @Functional Fetch
 *  All network requests are being intercepted here.
 *
 *  void respondWith(Promise<Response> r);
 */
self.addEventListener('fetch', event => {
  // logs for debugging
  //console.log(`fetch ${event.request.url}`)
  //console.log(` - type: ${event.request.type}; destination: ${event.request.destination}`)
  //console.log(` - mode: ${event.request.mode}, accept: ${event.request.headers.get('accept')}`)

  // 只拦截本站请求；外部 CDN 交给浏览器 HTTP 缓存。
  if (HOSTNAME_WHITELIST.indexOf(new URL(event.request.url).hostname) > -1) {

    // Redirect in SW manually fixed github pages 404s on repo?blah
    if (shouldRedirect(event.request)) {
      event.respondWith(Response.redirect(getRedirectUrl(event.request)))
      return;
    }

    // Network-first for HTML navigations.
    // When the network is reachable we always serve the freshly fetched page, so a
    // plain refresh shows the latest content. Cache and offline page are fallbacks.
    if (isNavigationReq(event.request)) {
      const cachedNav = caches.match(event.request);
      const fetchedNav = fetch(getCacheBustingUrl(event.request), { cache: "no-store" });
      const fetchedNavCopy = fetchedNav.then(resp => resp.clone());

      event.respondWith(
        fetchedNav
          .catch(_ => cachedNav)
          .then(resp => resp || cachedNav)
          .then(resp => resp || caches.match('offline.html'))
          .catch(_ => caches.match('offline.html'))
      );

      // keep the cached copy fresh for offline visits
      event.waitUntil(
        Promise.all([fetchedNavCopy, caches.open(CACHE)])
          .then(([response, cache]) => response.ok && cache.put(event.request, response))
          .catch(_ => {/* eat any errors */ })
      );
      return;
    }

    // Stale-while-revalidate for the remaining static resources
    // similar to HTTP's stale-while-revalidate: https://www.mnot.net/blog/2007/12/12/stale
    // Upgrade from Jake's to Surma's: https://gist.github.com/surma/eb441223daaedf880801ad80006389f1
    // 静态资源不再追加 cache-bust、也不再用 no-store：保留浏览器/边缘 HTTP 缓存，
    // 发布失效交给版本化 cache（CACHE_VERSION）处理；cache-bust 只保留给 HTML 导航。
    const cached = caches.match(event.request);
    const fetched = fetch(event.request);
    const fetchedCopy = fetched.then(resp => resp.clone());
    
    // Call respondWith() with whatever we get first.
    // Promise.race() resolves with first one settled (even rejected)
    // If the fetch fails (e.g disconnected), wait for the cache.
    // If there’s nothing in cache, wait for the fetch.
    // If neither yields a response, return offline pages.
    event.respondWith(
      Promise.race([fetched.catch(_ => cached), cached])
        .then(resp => resp || fetched)
        .catch(_ => caches.match('offline.html'))
    );

    // Update the cache with the version we fetched (only for ok status)
    event.waitUntil(
      Promise.all([fetchedCopy, caches.open(CACHE)])
        .then(([response, cache]) => response.ok && cache.put(event.request, response))
        .catch(_ => {/* eat any errors */ })
    );
  }
});


