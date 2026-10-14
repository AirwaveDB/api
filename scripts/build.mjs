#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'v1');
const USER_AGENT = 'AirwaveDB-api/1.5 (+https://github.com/AirwaveDB/api)';
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

async function resolveMainSha(repo) {
  const value = await getJson(`https://api.github.com/repos/AirwaveDB/${repo}/commits/main`);
  if (!/^[0-9a-f]{40}$/.test(value?.sha || '')) {
    throw new Error(`Could not resolve immutable main commit for AirwaveDB/${repo}`);
  }
  return value.sha;
}

function addTo(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

async function main() {
  // Resolve both repositories once, then read every file through those immutable
  // commit URLs. This prevents raw.githubusercontent.com/main cache skew or a
  // mid-build upstream push from mixing two source generations.
  const [databaseCommit, streamsCommit] = await Promise.all([
    resolveMainSha('database'),
    resolveMainSha('streams'),
  ]);
  const DB_RAW = `https://raw.githubusercontent.com/AirwaveDB/database/${databaseCommit}/data`;
  const STREAM_RAW = `https://raw.githubusercontent.com/AirwaveDB/streams/${streamsCommit}/data`;

  const [dbIndex, streamIndex] = await Promise.all([
    getJson(`${DB_RAW}/index.json`),
    getJson(`${STREAM_RAW}/index.json`),
  ]);

  if (Number(dbIndex.schemaVersion) !== 1) {
    throw new Error(`Unsupported database schema version: ${dbIndex.schemaVersion}`);
  }
  if (Number(streamIndex.schemaVersion) !== 1) {
    throw new Error(`Unsupported streams schema version: ${streamIndex.schemaVersion}`);
  }
  if (!dbIndex.generatedAt || !streamIndex.generatedAt || !streamIndex.databaseGeneratedAt) {
    throw new Error('Source indexes are missing required snapshot timestamps');
  }
  if (streamIndex.databaseGeneratedAt !== dbIndex.generatedAt) {
    throw new Error(
      `Source snapshots are inconsistent: streams were built from database ${streamIndex.databaseGeneratedAt}, ` +
      `but pinned database ${databaseCommit.slice(0, 12)} contains ${dbIndex.generatedAt}`,
    );
  }

  const streamCountries = new Set((streamIndex.countries || []).map((item) => item.code));

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

  const countries = countriesRaw.map((item) => ({
    code: item.code,
    stationCount: Number(item.stationCount || 0),
  }));
  const languages = languagesRaw.map((item) => ({
    code: item.code,
    stationCount: (byLanguage.get(item.code) || []).length,
  }));
  const categories = categoriesRaw.map((item) => ({
    id: item.id,
    stationCount: (byCategory.get(item.id) || []).length,
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
    writeFile(join(OUT, 'stations.ndjson'), stations.map((item) => JSON.stringify(item)).join('\n') + '\n'),
    writeFile(join(OUT, 'streams.ndjson'), streams.map((item) => JSON.stringify(item)).join('\n') + '\n'),
    writeFile(join(OUT, 'countries.json'), pretty(countries)),
    writeFile(join(OUT, 'languages.json'), pretty(languages)),
    writeFile(join(OUT, 'categories.json'), pretty(categories)),
    writeFile(join(OUT, 'index.json'), pretty({
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      stationCount: stations.length,
      streamCount: streams.length,
      countryCount: countries.length,
      languageCount: languages.length,
      categoryCount: categories.length,
      databaseGeneratedAt: dbIndex.generatedAt,
      streamsGeneratedAt: streamIndex.generatedAt,
      databaseSchemaVersion: dbIndex.schemaVersion,
      streamsSchemaVersion: streamIndex.schemaVersion,
      sourceSnapshots: {
        database: {
          commit: databaseCommit,
          generatedAt: dbIndex.generatedAt,
          schemaVersion: dbIndex.schemaVersion,
        },
        streams: {
          commit: streamsCommit,
          generatedAt: streamIndex.generatedAt,
          schemaVersion: streamIndex.schemaVersion,
          databaseGeneratedAt: streamIndex.databaseGeneratedAt,
          idStrategy: streamIndex.idStrategy || null,
        },
      },
      quality: {
        database: dbIndex.quality || {},
        streams: streamIndex.quality || {},
      },
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
