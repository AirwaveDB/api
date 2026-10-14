#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const V1 = join(ROOT, 'v1');
const errors = [];

function fail(message) {
  if (errors.length < 200) errors.push(message);
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [index, stations, streams, countries, languages, categories] = await Promise.all([
    json(join(V1, 'index.json')),
    json(join(V1, 'stations.json')),
    json(join(V1, 'streams.json')),
    json(join(V1, 'countries.json')),
    json(join(V1, 'languages.json')),
    json(join(V1, 'categories.json')),
  ]);

  if (Number(index.schemaVersion) !== 1) fail(`schemaVersion ${index.schemaVersion} != 1`);
  if (stations.length !== Number(index.stationCount)) fail(`stationCount ${index.stationCount} != ${stations.length}`);
  if (streams.length !== Number(index.streamCount)) fail(`streamCount ${index.streamCount} != ${streams.length}`);
  if (countries.length !== Number(index.countryCount)) fail(`countryCount ${index.countryCount} != ${countries.length}`);
  if (languages.length !== Number(index.languageCount)) fail(`languageCount ${index.languageCount} != ${languages.length}`);
  if (categories.length !== Number(index.categoryCount)) fail(`categoryCount ${index.categoryCount} != ${categories.length}`);
  if (!index.databaseGeneratedAt || Number.isNaN(Date.parse(index.databaseGeneratedAt))) fail('invalid databaseGeneratedAt');
  if (!index.streamsGeneratedAt || Number.isNaN(Date.parse(index.streamsGeneratedAt))) fail('invalid streamsGeneratedAt');
  if (index.databaseSchemaVersion !== null && Number(index.databaseSchemaVersion) !== 1) fail(`unsupported databaseSchemaVersion ${index.databaseSchemaVersion}`);
  if (index.streamsSchemaVersion !== null && Number(index.streamsSchemaVersion) !== 1) fail(`unsupported streamsSchemaVersion ${index.streamsSchemaVersion}`);

  const stationIds = new Set();
  const stationById = new Map();
  const stationCounts = new Map();
  const languageCounts = new Map();
  const categoryCounts = new Map();

  for (const station of stations) {
    if (!/^awb_[0-9a-f]{20}$/.test(station.id)) fail(`invalid station id ${station.id}`);
    if (stationIds.has(station.id)) fail(`duplicate station id ${station.id}`);
    stationIds.add(station.id);
    stationById.set(station.id, station);
    stationCounts.set(station.country, (stationCounts.get(station.country) || 0) + 1);
    for (const code of station.languages || []) languageCounts.set(code, (languageCounts.get(code) || 0) + 1);
    for (const id of station.categories || []) categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }

  const streamIds = new Set();
  const streamCounts = new Map();
  const streamCountsByStation = new Map();
  for (const stream of streams) {
    if (!/^aws_[0-9a-f]{20}$/.test(stream.id)) fail(`invalid stream id ${stream.id}`);
    if (streamIds.has(stream.id)) fail(`duplicate stream id ${stream.id}`);
    streamIds.add(stream.id);
    if (!stationIds.has(stream.stationId)) fail(`stream ${stream.id} references unknown station ${stream.stationId}`);
    const station = stationById.get(stream.stationId);
    if (station && stream.country !== station.country) fail(`stream ${stream.id} country ${stream.country} != station country ${station.country}`);
    if (!Array.isArray(stream.sources) || stream.sources.length !== stream.sourceIds?.length) fail(`stream ${stream.id} has invalid provenance`);
    streamCounts.set(stream.country, (streamCounts.get(stream.country) || 0) + 1);
    streamCountsByStation.set(stream.stationId, (streamCountsByStation.get(stream.stationId) || 0) + 1);
    try {
      const url = new URL(stream.url);
      if (!['http:', 'https:'].includes(url.protocol)) fail(`stream ${stream.id} uses unsupported protocol`);
    } catch {
      fail(`stream ${stream.id} has invalid URL`);
    }
  }

  const countryFiles = (await readdir(join(V1, 'countries'))).filter((name) => /^[a-z]{2}\.json$/.test(name));
  if (countryFiles.length !== countries.length) fail(`country file count ${countryFiles.length} != ${countries.length}`);
  for (const item of countries) {
    const actualStations = stationCounts.get(item.code) || 0;
    const actualStreams = streamCounts.get(item.code) || 0;
    if (actualStations !== Number(item.stationCount)) fail(`country ${item.code}: stationCount ${item.stationCount} != ${actualStations}`);
    const doc = await json(join(V1, 'countries', `${item.code.toLowerCase()}.json`));
    if (doc.code !== item.code) fail(`country ${item.code}: code mismatch`);
    if (doc.stations?.length !== actualStations) fail(`country ${item.code}: endpoint station count mismatch`);
    if (Number(doc.streamCount) !== actualStreams) fail(`country ${item.code}: endpoint stream count ${doc.streamCount} != ${actualStreams}`);
    for (const station of doc.stations || []) {
      if (station.country !== item.code) fail(`country ${item.code}: contains station ${station.id} from ${station.country}`);
      const expected = streamCountsByStation.get(station.id) || 0;
      if (station.streams?.length !== expected) fail(`country ${item.code}: station ${station.id} has ${station.streams?.length} streams, expected ${expected}`);
    }
  }

  for (const item of languages) {
    const actual = languageCounts.get(item.code) || 0;
    if (actual !== Number(item.stationCount)) fail(`language ${item.code}: stationCount ${item.stationCount} != ${actual}`);
    const doc = await json(join(V1, 'languages', `${item.code}.json`));
    if (doc.stations?.length !== actual) fail(`language ${item.code}: endpoint count mismatch`);
    for (const station of doc.stations || []) {
      if (!station.languages?.includes(item.code)) fail(`language ${item.code}: station ${station.id} does not declare language`);
    }
  }

  for (const item of categories) {
    const actual = categoryCounts.get(item.id) || 0;
    if (actual !== Number(item.stationCount)) fail(`category ${item.id}: stationCount ${item.stationCount} != ${actual}`);
    const doc = await json(join(V1, 'categories', `${item.id}.json`));
    if (doc.stations?.length !== actual) fail(`category ${item.id}: endpoint count mismatch`);
    for (const station of doc.stations || []) {
      if (!station.categories?.includes(item.id)) fail(`category ${item.id}: station ${station.id} does not declare category`);
    }
  }

  const shardFiles = (await readdir(join(V1, '_lookup', 'stations'))).filter((name) => /^[0-9a-f]{2}\.json$/.test(name));
  const shardIds = new Set();
  for (const file of shardFiles) {
    const shard = await json(join(V1, '_lookup', 'stations', file));
    for (const [id, value] of Object.entries(shard)) {
      if (id !== value.id) fail(`${file}: station key/id mismatch for ${id}`);
      if (id.slice(4, 6) !== file.slice(0, 2)) fail(`${file}: wrong shard for ${id}`);
      if (shardIds.has(id)) fail(`${file}: duplicate lookup station ${id}`);
      shardIds.add(id);
      const expected = streamCountsByStation.get(id) || 0;
      if (value.streams?.length !== expected) fail(`${file}: station ${id} has ${value.streams?.length} streams, expected ${expected}`);
    }
  }
  if (shardIds.size !== stationIds.size) fail(`station lookup contains ${shardIds.size} stations, expected ${stationIds.size}`);

  const stationText = (await readFile(join(V1, 'stations.ndjson'), 'utf8')).trimEnd();
  const streamText = (await readFile(join(V1, 'streams.ndjson'), 'utf8')).trimEnd();
  const stationLines = stationText ? stationText.split('\n') : [];
  const streamLines = streamText ? streamText.split('\n') : [];
  if (stationLines.length !== stations.length) fail(`stations.ndjson lines ${stationLines.length} != ${stations.length}`);
  if (streamLines.length !== streams.length) fail(`streams.ndjson lines ${streamLines.length} != ${streams.length}`);
  for (const [lineIndex, line] of stationLines.entries()) {
    try { JSON.parse(line); } catch { fail(`stations.ndjson line ${lineIndex + 1} is invalid JSON`); }
  }
  for (const [lineIndex, line] of streamLines.entries()) {
    try { JSON.parse(line); } catch { fail(`streams.ndjson line ${lineIndex + 1} is invalid JSON`); }
  }

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
    process.stderr.write(`Validation failed with ${errors.length}${errors.length === 200 ? '+' : ''} errors\n`);
    process.exit(1);
  }

  process.stdout.write(`Validated ${stations.length} stations, ${streams.length} streams, ${countries.length} countries, ${languages.length} languages, and ${categories.length} categories\n`);
}

await main();
