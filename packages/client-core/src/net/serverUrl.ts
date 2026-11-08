/**
 * `?server=` may only point at the page's own host or loopback (any port): a crafted link must not be able to make the
 * client send credentials to a third-party host. Anything else is ignored. Returns an origin like `http://localhost:8080`.
 */
export function resolveServer(requested: string | null, pageHost: string): { origin: string; ignored: boolean } {
  const fallback = `http://${pageHost || 'localhost'}:8080`;
  if (!requested) return { origin: fallback, ignored: false };
  try {
    const u = new URL(/^https?:\/\//.test(requested) ? requested : `http://${requested}`);
    const allowed = new Set([pageHost, 'localhost', '127.0.0.1'].filter(Boolean));
    if (!allowed.has(u.hostname) || u.username || u.password || (u.pathname !== '/' && u.pathname !== ''))
      return { origin: fallback, ignored: true };
    return { origin: u.origin, ignored: false };
  } catch {
    return { origin: fallback, ignored: true };
  }
}
