#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const V1 = join(ROOT, 'v1');
const USER_AGENT = 'AirwaveDB-api/1.6 (+https://github.com/AirwaveDB/api)';
const pretty = (value) => JSON.stringify(value, null, 2) + '\n';

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function main() {
  const indexPath = join(V1, 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const databaseCommit = index.sourceSnapshots?.database?.commit;
  if (!/^[0-9a-f]{40}$/.test(databaseCommit || '')) {
    throw new Error('API index is missing an immutable database source commit');
  }

  const aliases = await getJson(
    `https://raw.githubusercontent.com/AirwaveDB/database/${databaseCommit}/data/language_aliases.json`,
  );
  if (!Array.isArray(aliases)) throw new Error('language_aliases.json must be an array');

  const canonicalLanguages = JSON.parse(await readFile(join(V1, 'languages.json'), 'utf8'));
  const canonicalCodes = new Set(canonicalLanguages.map((item) => item.code));

  for (const item of aliases) {
    if (!/^[a-z]{2,3}$/.test(item.alias || '') || !/^[a-z]{2,3}$/.test(item.code || '')) {
      throw new Error(`Invalid language alias ${JSON.stringify(item)}`);
    }
    if (!canonicalCodes.has(item.code)) {
      throw new Error(`Language alias ${item.alias} targets missing canonical code ${item.code}`);
    }

    const canonical = JSON.parse(await readFile(join(V1, 'languages', `${item.code}.json`), 'utf8'));
    await writeFile(
      join(V1, 'languages', `${item.alias}.json`),
      pretty({
        code: item.alias,
        canonicalCode: item.code,
        stationCount: canonical.stationCount,
        stations: canonical.stations,
      }),
    );
  }

  await writeFile(join(V1, 'language_aliases.json'), pretty(aliases));
  index.languageAliasCount = aliases.length;
  await writeFile(indexPath, pretty(index));

  process.stdout.write(`Built ${aliases.length} backwards-compatible language aliases\n`);
}

await main();
