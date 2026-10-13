#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'v1');
const DB_RAW = 'https://raw.githubusercontent.com/AirwaveDB/database/main/data';
const STREAM_RAW = 'https://raw.githubusercontent.com/AirwaveDB/streams/main/data';
const USER_AGENT = 'AirwaveDB-api/1.3 (+https://github.com/AirwaveDB/api)';
const TIMEOUT_MS = 20_000;
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function getArray(url) {
  const value = await getJson(url);
  if (!Array.isArray(value)) throw new Error(`Expected JSON array: ${url}`);
  return value;
}

function addTo(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

async function main() {
  const [dbIndex, streamIndex] = await Promise.all([
    getJson(`${DB_RAW}/index.json`),
    getJson(`${STREAM_RAW}/index.json`),
  ]);
  const streamCountries = new Set((streamIndex.countries || []).map((x) => x.code));

  await rm(OUT, { recursive: true, force: true });
  await Promise.all([
    mkdir(join(OUT, 'countries'), { recursive: true }),
    mkdir(join(OUT, 'categories'), { recursive: true }),
    mkdir(join(OUT, 'languages'), { recursive: true }),
    mkdir(join(OUT, '_lookup', 'stations'), { recursive: true }),
  ]);

  const stations = [];
  const streams = [];
  const byCategory = new Map();
  const byLanguage = new Map();
  const stationShards = new Map();

  for (const country of dbIndex.countries || []) {
    const code = country.code;
    const stationRows = await getArray(`${DB_RAW}/stations/${code}.json`);
    const streamRows = streamCountries.has(code)
      ? await getArray(`${STREAM_RAW}/streams/${code}.json`)
      : [];

    stations.push(...stationRows);
    streams.push(...streamRows);

    const byStation = new Map();
    for (const item of streamRows) addTo(byStation, item.stationId, item);

    const joined = stationRows.map((item) => ({ ...item, streams: byStation.get(item.id) || [] }));

    for (const item of joined) {
      for (const category of item.categories || []) addTo(byCategory, category, item);
      for (const language of item.languages || []) addTo(byLanguage, language, item);

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
    getArray(`${DB_RAW}/countries.json`),
    getArray(`${DB_RAW}/languages.json`),
    getArray(`${DB_RAW}/categories.json`),
  ]);

  const countries = countriesRaw.map((x) => ({
    code: x.code,
    stationCount: Number(x.stationCount || 0),
  }));
  const languages = languagesRaw.map((x) => ({
    code: x.code,
    stationCount: (byLanguage.get(x.code) || []).length,
  }));
  const categories = categoriesRaw.map((x) => ({
    id: x.id,
    stationCount: (byCategory.get(x.id) || []).length,
  }));

  for (const item of categories) {
    const list = byCategory.get(item.id) || [];
    await writeFile(
      join(OUT, 'categories', `${item.id}.json`),
      pretty({ id: item.id, stationCount: list.length, stations: list }),
    );
  }

  for (const item of languages) {
    const list = byLanguage.get(item.code) || [];
    await writeFile(
      join(OUT, 'languages', `${item.code}.json`),
      pretty({ code: item.code, stationCount: list.length, stations: list }),
    );
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
      databaseGeneratedAt: dbIndex.generatedAt || null,
      streamsGeneratedAt: streamIndex.generatedAt || null,
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
