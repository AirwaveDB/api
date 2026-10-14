#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const V1 = join(ROOT, 'v1');
const CODE = /^[a-z]{2,3}$/;
const errors = [];

function fail(message) {
  if (errors.length < 200) errors.push(message);
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [index, languages, aliases] = await Promise.all([
    json(join(V1, 'index.json')),
    json(join(V1, 'languages.json')),
    json(join(V1, 'language_aliases.json')),
  ]);

  const canonicalCodes = new Set(languages.map((item) => item.code));
  const aliasCodes = new Set();

  for (const item of aliases) {
    if (!CODE.test(item.alias || '')) fail(`invalid alias ${item.alias}`);
    if (!CODE.test(item.code || '')) fail(`invalid alias target ${item.code}`);
    if (item.alias === item.code) fail(`self alias ${item.alias}`);
    if (aliasCodes.has(item.alias)) fail(`duplicate alias ${item.alias}`);
    if (canonicalCodes.has(item.alias)) fail(`alias ${item.alias} is also canonical`);
    if (!canonicalCodes.has(item.code)) fail(`alias ${item.alias} targets missing language ${item.code}`);
    aliasCodes.add(item.alias);

    const [aliasDoc, canonicalDoc] = await Promise.all([
      json(join(V1, 'languages', `${item.alias}.json`)),
      json(join(V1, 'languages', `${item.code}.json`)),
    ]);

    if (aliasDoc.code !== item.alias) fail(`${item.alias}: alias endpoint code mismatch`);
    if (aliasDoc.canonicalCode !== item.code) fail(`${item.alias}: canonicalCode mismatch`);
    if (Number(aliasDoc.stationCount) !== Number(canonicalDoc.stationCount)) {
      fail(`${item.alias}: stationCount differs from ${item.code}`);
    }
    if ((aliasDoc.stations || []).length !== (canonicalDoc.stations || []).length) {
      fail(`${item.alias}: station list length differs from ${item.code}`);
    }
  }

  if (Number(index.languageAliasCount) !== aliases.length) {
    fail(`index.languageAliasCount ${index.languageAliasCount} != ${aliases.length}`);
  }

  if (errors.length) {
    for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
    process.stderr.write(`Language alias validation failed with ${errors.length}${errors.length === 200 ? '+' : ''} errors\n`);
    process.exit(1);
  }

  process.stdout.write(`Validated ${aliases.length} backwards-compatible language aliases\n`);
}

await main();
