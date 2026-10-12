#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'v1');
const DB_RAW = 'https://raw.githubusercontent.com/AirwaveDB/database/main/data';
const STREAM_RAW = 'https://raw.githubusercontent.com/AirwaveDB/streams/main/data';
const USER_AGENT = 'AirwaveDB-api/1.0 (+https://github.com/AirwaveDB/api)';
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

async function main() {
  const [dbIndex, streamIndex] = await Promise.all([
    (await get(`${DB_RAW}/index.json`)).json(),
    (await get(`${STREAM_RAW}/index.json`)).json(),
  ]);
  const streamCountries = new Set(streamIndex.countries.map((x) => x.code));

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'countries'), { recursive: true });

  const stations = [];
  const streams = [];
  for (const country of dbIndex.countries) {
    const code = country.code;
    const stationRows = (await csvFile(`${DB_RAW}/stations/${code}.csv`)).map(station);
    let streamRows = [];
    if (streamCountries.has(code)) streamRows = (await csvFile(`${STREAM_RAW}/streams/${code}.csv`)).map(stream);
    stations.push(...stationRows);
    streams.push(...streamRows);

    const byStation = new Map();
    for (const item of streamRows) {
      const list = byStation.get(item.stationId) || [];
      list.push(item);
      byStation.set(item.stationId, list);
    }
    const joined = stationRows.map((item) => ({ ...item, streams: byStation.get(item.id) || [] }));
    await writeFile(join(OUT, 'countries', `${code.toLowerCase()}.json`), JSON.stringify({ country: code, stations: joined }, null, 2) + '\n');
    process.stdout.write(`${code}: ${stationRows.length} stations, ${streamRows.length} streams\n`);
  }

  const [countries, languages, categories] = await Promise.all([
    csvFile(`${DB_RAW}/countries.csv`),
    csvFile(`${DB_RAW}/languages.csv`),
    csvFile(`${DB_RAW}/categories.csv`),
  ]);

  await Promise.all([
    writeFile(join(OUT, 'stations.json'), JSON.stringify(stations, null, 2) + '\n'),
    writeFile(join(OUT, 'streams.json'), JSON.stringify(streams, null, 2) + '\n'),
    writeFile(join(OUT, 'stations.ndjson'), stations.map((x) => JSON.stringify(x)).join('\n') + '\n'),
    writeFile(join(OUT, 'streams.ndjson'), streams.map((x) => JSON.stringify(x)).join('\n') + '\n'),
    writeFile(join(OUT, 'countries.json'), JSON.stringify(countries.map((x) => ({ code: x.code, stationCount: num(x.station_count) })), null, 2) + '\n'),
    writeFile(join(OUT, 'languages.json'), JSON.stringify(languages.map((x) => ({ code: x.code, stationCount: num(x.station_count) })), null, 2) + '\n'),
    writeFile(join(OUT, 'categories.json'), JSON.stringify(categories.map((x) => ({ id: x.id, stationCount: num(x.station_count) })), null, 2) + '\n'),
    writeFile(join(OUT, 'index.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      stationCount: stations.length,
      streamCount: streams.length,
      countryCount: dbIndex.countries.length,
      databaseGeneratedAt: dbIndex.generated_at,
      streamsGeneratedAt: streamIndex.generated_at,
    }, null, 2) + '\n'),
  ]);
}

await main();
