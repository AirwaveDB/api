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

  if (stations.length !== Number(index.stationCount)) fail(`stationCount ${index.stationCount} != ${stations.length}`);
  if (streams.length !== Number(index.streamCount)) fail(`streamCount ${index.streamCount} != ${streams.length}`);
  if (countries.length !== Number(index.countryCount)) fail(`countryCount ${index.countryCount} != ${countries.length}`);
  if (languages.length !== Number(index.languageCount)) fail(`languageCount ${index.languageCount} != ${languages.length}`);
  if (categories.length !== Number(index.categoryCount)) fail(`categoryCount ${index.categoryCount} != ${categories.length}`);

  const stationIds = new Set();
  const stationCounts = new Map();
  const languageCounts = new Map();
  const categoryCounts = new Map();

  for (const station of stations) {
    if (!/^awb_[0-9a-f]{20}$/.test(station.id)) fail(`invalid station id ${station.id}`);
    if (stationIds.has(station.id)) fail(`duplicate station id ${station.id}`);
    stationIds.add(station.id);
    stationCounts.set(station.country, (stationCounts.get(station.country) || 0) + 1);
    for (const code of station.languages || []) languageCounts.set(code, (languageCounts.get(code) || 0) + 1);
    for (const id of station.categories || []) categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }

  const streamIds = new Set();
  for (const stream of streams) {
    if (!/^aws_[0-9a-f]{20}$/.test(stream.id)) fail(`invalid stream id ${stream.id}`);
    if (streamIds.has(stream.id)) fail(`duplicate stream id ${stream.id}`);
    streamIds.add(stream.id);
    if (!stationIds.has(stream.stationId)) fail(`stream ${stream.id} references unknown station ${stream.stationId}`);
    try {
      const url = new URL(stream.url);
      if (!['http:', 'https:'].includes(url.protocol)) fail(`stream ${stream.id} uses unsupported protocol`);
    } catch {
      fail(`stream ${stream.id} has invalid URL`);
    }
  }

  const countryFiles = (await readdir(join(V1, 'countries'))).filter((x) => /^[a-z]{2}\.json$/.test(x));
  if (countryFiles.length !== countries.length) fail(`country file count ${countryFiles.length} != ${countries.length}`);
  for (const item of countries) {
    const actual = stationCounts.get(item.code) || 0;
    if (actual !== Number(item.stationCount)) fail(`country ${item.code}: stationCount ${item.stationCount} != ${actual}`);
    const doc = await json(join(V1, 'countries', `${item.code.toLowerCase()}.json`));
    if (doc.code !== item.code) fail(`country ${item.code}: code mismatch`);
    if (doc.stations?.length !== actual) fail(`country ${item.code}: endpoint count mismatch`);
  }

  for (const item of languages) {
    const actual = languageCounts.get(item.code) || 0;
    if (actual !== Number(item.stationCount)) fail(`language ${item.code}: stationCount ${item.stationCount} != ${actual}`);
    const doc = await json(join(V1, 'languages', `${item.code}.json`));
    if (doc.stations?.length !== actual) fail(`language ${item.code}: endpoint count mismatch`);
  }

  for (const item of categories) {
    const actual = categoryCounts.get(item.id) || 0;
    if (actual !== Number(item.stationCount)) fail(`category ${item.id}: stationCount ${item.stationCount} != ${actual}`);
    const doc = await json(join(V1, 'categories', `${item.id}.json`));
    if (doc.stations?.length !== actual) fail(`category ${item.id}: endpoint count mismatch`);
  }

  const shardFiles = (await readdir(join(V1, '_lookup', 'stations'))).filter((x) => /^[0-9a-f]{2}\.json$/.test(x));
  const shardIds = new Set();
  for (const file of shardFiles) {
    const shard = await json(join(V1, '_lookup', 'stations', file));
    for (const [id, value] of Object.entries(shard)) {
      if (id !== value.id) fail(`${file}: station key/id mismatch for ${id}`);
      if (id.slice(4, 6) !== file.slice(0, 2)) fail(`${file}: wrong shard for ${id}`);
      if (shardIds.has(id)) fail(`${file}: duplicate lookup station ${id}`);
      shardIds.add(id);
    }
  }
  if (shardIds.size !== stationIds.size) fail(`station lookup contains ${shardIds.size} stations, expected ${stationIds.size}`);

  const stationLines = (await readFile(join(V1, 'stations.ndjson'), 'utf8')).trimEnd().split('\n').length;
  const streamLines = (await readFile(join(V1, 'streams.ndjson'), 'utf8')).trimEnd().split('\n').length;
  if (stationLines !== stations.length) fail(`stations.ndjson lines ${stationLines} != ${stations.length}`);
  if (streamLines !== streams.length) fail(`streams.ndjson lines ${streamLines} != ${streams.length}`);

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
    process.stderr.write(`Validation failed with ${errors.length}${errors.length === 200 ? '+' : ''} errors\n`);
    process.exit(1);
  }

  process.stdout.write(`Validated ${stations.length} stations, ${streams.length} streams, ${countries.length} countries, ${languages.length} languages, and ${categories.length} categories\n`);
}

await main();
