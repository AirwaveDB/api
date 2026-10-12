#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'v1');
const DB_RAW = 'https://raw.githubusercontent.com/AirwaveDB/database/main/data';
const STREAM_RAW = 'https://raw.githubusercontent.com/AirwaveDB/streams/main/data';
const USER_AGENT = 'AirwaveDB-api/1.1 (+https://github.com/AirwaveDB/api)';
const TIMEOUT_MS = 20_000;

async function get(url, accept = 'application/json') {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

const split = (value) => String(value || '').split(';').filter(Boolean);
const num = (value) => Number(value || 0);
const bool = (value) => value === 'true' || value === '1';
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

function station(row) {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    subdivision: row.subdivision || null,
    languages: split(row.language_codes),
    categories: split(row.categories),
    tags: split(row.tags),
    homepage: row.homepage || null,
    favicon: row.favicon || null,
    type: row.type || null,
    sourceCount: num(row.source_count),
    updatedAt: row.updated_at || null,
  };
}

function stream(row) {
  return {
    id: row.id,
    stationId: row.station_id,
    url: row.url,
    codec: row.codec || null,
    bitrate: num(row.bitrate),
    protocol: row.protocol || null,
    hls: bool(row.hls),
    sources: split(row.sources),
    sourceIds: split(row.source_ids),
    lastCheckOk: bool(row.last_check_ok),
    lastCheckedAt: row.last_checked_at || null,
  };
}

async function csvFile(url) {
  return parseCsv(await (await get(url, 'text/csv')).text());
}

function addTo(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

async function main() {
  const [dbIndex, streamIndex] = await Promise.all([
    (await get(`${DB_RAW}/index.json`)).json(),
    (await get(`${STREAM_RAW}/index.json`)).json(),
  ]);
  const streamCountries = new Set(streamIndex.countries.map((x) => x.code));

  await rm(OUT, { recursive: true, force: true });
  await Promise.all([
    mkdir(join(OUT, 'countries'), { recursive: true }),
    mkdir(join(OUT, 'categories'), { recursive: true }),
    mkdir(join(OUT, 'languages'), { recursive: true }),
    mkdir(join(OUT, '_lookup', 'stations'), { recursive: true }),
  ]);

  const stations = [];
  const streams = [];
  const joinedStations = [];
  const byCategory = new Map();
  const byLanguage = new Map();
  const stationShards = new Map();

  for (const country of dbIndex.countries) {
    const code = country.code;
    const stationRows = (await csvFile(`${DB_RAW}/stations/${code}.csv`)).map(station);
    let streamRows = [];
    if (streamCountries.has(code)) streamRows = (await csvFile(`${STREAM_RAW}/streams/${code}.csv`)).map(stream);

    stations.push(...stationRows);
    streams.push(...streamRows);

    const byStation = new Map();
    for (const item of streamRows) addTo(byStation, item.stationId, item);

    const joined = stationRows.map((item) => ({ ...item, streams: byStation.get(item.id) || [] }));
    joinedStations.push(...joined);

    for (const item of joined) {
      for (const category of item.categories) addTo(byCategory, category, item);
      for (const language of item.languages) addTo(byLanguage, language, item);
      const shard = item.id.slice(4, 6);
      const bucket = stationShards.get(shard) || {};
      bucket[item.id] = item;
      stationShards.set(shard, bucket);
    }

    await writeFile(join(OUT, 'countries', `${code.toLowerCase()}.json`), pretty({
      code,
      stationCount: joined.length,
      streamCount: streamRows.length,
      stations: joined,
    }));
    process.stdout.write(`${code}: ${stationRows.length} stations, ${streamRows.length} streams\n`);
  }

  const [countriesRaw, languagesRaw, categoriesRaw] = await Promise.all([
    csvFile(`${DB_RAW}/countries.csv`),
    csvFile(`${DB_RAW}/languages.csv`),
    csvFile(`${DB_RAW}/categories.csv`),
  ]);

  const countries = countriesRaw.map((x) => ({ code: x.code, stationCount: num(x.station_count) }));
  const languages = languagesRaw.map((x) => ({ code: x.code, stationCount: (byLanguage.get(x.code) || []).length }));
  const categories = categoriesRaw.map((x) => ({ id: x.id, stationCount: (byCategory.get(x.id) || []).length }));

  for (const item of categories) {
    const list = byCategory.get(item.id) || [];
    await writeFile(join(OUT, 'categories', `${item.id}.json`), pretty({
      id: item.id,
      stationCount: list.length,
      stations: list,
    }));
  }

  for (const item of languages) {
    const list = byLanguage.get(item.code) || [];
    await writeFile(join(OUT, 'languages', `${item.code}.json`), pretty({
      code: item.code,
      stationCount: list.length,
      stations: list,
    }));
  }

  for (const [shard, bucket] of stationShards) {
    await writeFile(join(OUT, '_lookup', 'stations', `${shard}.json`), pretty(bucket));
  }

  await Promise.all([
    writeFile(join(OUT, 'stations.json'), pretty(stations)),
    writeFile(join(OUT, 'streams.json'), pretty(streams)),
    writeFile(join(OUT, 'stations.ndjson'), stations.map((x) => JSON.stringify(x)).join('\n') + '\n'),
    writeFile(join(OUT, 'streams.ndjson'), streams.map((x) => JSON.stringify(x)).join('\n') + '\n'),
    writeFile(join(OUT, 'countries.json'), pretty(countries)),
    writeFile(join(OUT, 'languages.json'), pretty(languages)),
    writeFile(join(OUT, 'categories.json'), pretty(categories)),
    writeFile(join(OUT, 'index.json'), pretty({
      generatedAt: new Date().toISOString(),
      stationCount: stations.length,
      streamCount: streams.length,
      countryCount: countries.length,
      languageCount: languages.length,
      categoryCount: categories.length,
      databaseGeneratedAt: dbIndex.generated_at,
      streamsGeneratedAt: streamIndex.generated_at,
      routes: {
        station: '/v1/stations/:id',
        country: '/v1/countries/:code',
        category: '/v1/categories/:id',
        language: '/v1/languages/:code',
      },
    })),
  ]);
}

await main();
