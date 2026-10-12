const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2) + '\n', {
    status,
    headers: JSON_HEADERS,
  });
}

function notFound() {
  return json({ error: 'Not found' }, 404);
}

async function asset(env, path, request) {
  const url = new URL(request.url);
  url.pathname = path;
  const response = await env.ASSETS.fetch(new Request(url, request));
  if (response.status === 404) return notFound();
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'public, max-age=300');
  return new Response(response.body, { status: response.status, headers });
}

async function stationById(env, id, request) {
  if (!/^awb_[0-9a-f]{20}$/.test(id)) return notFound();
  const shard = id.slice(4, 6);
  const url = new URL(request.url);
  url.pathname = `/_lookup/stations/${shard}.json`;
  const response = await env.ASSETS.fetch(new Request(url, request));
  if (!response.ok) return notFound();
  const lookup = await response.json();
  return lookup[id] ? json(lookup[id]) : notFound();
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/' || path === '/v1') return asset(env, '/index.json', request);

    const station = path.match(/^\/v1\/stations\/(awb_[0-9a-f]{20})$/);
    if (station) return stationById(env, station[1], request);

    const country = path.match(/^\/v1\/countries\/([a-zA-Z]{2})$/);
    if (country) return asset(env, `/countries/${country[1].toLowerCase()}.json`, request);

    const category = path.match(/^\/v1\/categories\/([a-z0-9-]+)$/);
    if (category) return asset(env, `/categories/${category[1].toLowerCase()}.json`, request);

    const language = path.match(/^\/v1\/languages\/([a-zA-Z]{2,3})$/);
    if (language) return asset(env, `/languages/${language[1].toLowerCase()}.json`, request);

    const collections = new Map([
      ['/v1/index', '/index.json'],
      ['/v1/stations', '/stations.json'],
      ['/v1/streams', '/streams.json'],
      ['/v1/countries', '/countries.json'],
      ['/v1/categories', '/categories.json'],
      ['/v1/languages', '/languages.json'],
    ]);
    if (collections.has(path)) return asset(env, collections.get(path), request);

    if (path.startsWith('/v1/') && path.endsWith('.json')) {
      return asset(env, path.slice(3), request);
    }

    return notFound();
  },
};
