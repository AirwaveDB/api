#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'v1', 'index.json');
const STREAM_INDEX_URL = 'https://raw.githubusercontent.com/AirwaveDB/streams/main/data/index.json';
const USER_AGENT = 'AirwaveDB-api/1.4 (+https://github.com/AirwaveDB/api)';
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

const index = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
const streamIndex = await getJson(STREAM_INDEX_URL);

if (streamIndex.generatedAt !== index.streamsGeneratedAt) {
  throw new Error(
    `Stream snapshot changed during API build: built from ${index.streamsGeneratedAt}, current is ${streamIndex.generatedAt}`,
  );
}

index.sourceSnapshots = {
  database: {
    generatedAt: index.databaseGeneratedAt,
    schemaVersion: index.databaseSchemaVersion,
  },
  streams: {
    generatedAt: index.streamsGeneratedAt,
    schemaVersion: index.streamsSchemaVersion,
    idStrategy: streamIndex.idStrategy || null,
  },
};

await writeFile(INDEX_PATH, pretty(index));
process.stdout.write(`Annotated API snapshot metadata (${streamIndex.idStrategy || 'unknown stream ID strategy'})\n`);
