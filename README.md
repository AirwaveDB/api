# AirwaveDB API

Generated JSON and NDJSON distributions of the AirwaveDB dataset.

This repository contains static files. No API server is required.

## Endpoints

All files are published under `v1/`.

| Path | Description |
| --- | --- |
| `v1/index.json` | Dataset counts and build timestamps |
| `v1/stations.json` | All station metadata |
| `v1/streams.json` | All stream metadata |
| `v1/stations.ndjson` | One station JSON object per line |
| `v1/streams.ndjson` | One stream JSON object per line |
| `v1/countries.json` | Country index |
| `v1/languages.json` | Language index |
| `v1/categories.json` | Category index |
| `v1/countries/<cc>.json` | Stations and streams for one country |

Country filenames use lowercase ISO 3166-1 alpha-2 codes, for example `v1/countries/jp.json`.

## Data model

Station identity comes from [`AirwaveDB/database`](https://github.com/AirwaveDB/database). Stream endpoints come from [`AirwaveDB/streams`](https://github.com/AirwaveDB/streams). Country files join both datasets for clients that want a single document per country.

## Updates

Generated files are rebuilt from the current `database` and `streams` repositories. They should not be edited manually.

## License

AirwaveDB's generated directory data is released under CC0 1.0. Third-party station names, logos, websites, stream endpoints, and broadcasts remain subject to their respective owners' rights.