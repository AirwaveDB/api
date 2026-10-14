const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
};

function json(data, status = 200, method = 'GET') {
  return new Response(method === 'HEAD' ? null : JSON.stringify(data, null, 2) + '\n', {
    status,
    headers: JSON_HEADERS,
  });
}

function notFound(method = 'GET') {
  return json({ error: 'Not found' }, 404, method);
}

async function asset(env, path, request) {
  const url = new URL(request.url);
  url.pathname = path;
  const response = await env.ASSETS.fetch(new Request(url, request));
  if (response.status === 404) return notFound(request.method);
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'public, max-age=300');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

async function stationById(env, id, request) {
  if (!/^awb_[0-9a-f]{20}$/.test(id)) return notFound(request.method);

  const shard = id.slice(4, 6);
  const url = new URL(request.url);
  url.pathname = `/_lookup/stations/${shard}.json`;

  // Always read the lookup shard with GET. A HEAD request to the public route
  // still needs the object lookup, while an asset HEAD response has no JSON body.
  const lookupRequest = new Request(url, {
    method: 'GET',
    headers: request.headers,
  });
  const response = await env.ASSETS.fetch(lookupRequest);
  if (!response.ok) return notFound(request.method);

  const lookup = await response.json();
  return lookup[id] ? json(lookup[id], 200, request.method) : notFound(request.method);
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {
        status: 405,
        headers: {
          allow: 'GET, HEAD',
          'access-control-allow-origin': '*',
        },
      });
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
      ['/v1/stations.ndjson', '/stations.ndjson'],
      ['/v1/streams.ndjson', '/streams.ndjson'],
    ]);
    if (collections.has(path)) return asset(env, collections.get(path), request);

    // Lookup shards are implementation details, not part of the public contract.
    if (path.startsWith('/v1/_lookup/')) return notFound(request.method);

    // Static generated JSON remains available with its explicit file extension.
    if (path.startsWith('/v1/') && path.endsWith('.json')) {
      return asset(env, path.slice(3), request);
    }

    return notFound(request.method);
  },
};
