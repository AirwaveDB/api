# AirwaveDB API

Generated public API and distribution layer for the AirwaveDB internet radio directory.

AirwaveDB indexes internet radio stations and their playable stream endpoints. This repository is built from [`AirwaveDB/database`](https://github.com/AirwaveDB/database) and [`AirwaveDB/streams`](https://github.com/AirwaveDB/streams); generated files should not be edited manually.

## Endpoints

| Route | Description |
| --- | --- |
| `GET /v1` | Dataset counts and build timestamps |
| `GET /v1/stations` | All station metadata |
| `GET /v1/stations/:id` | One station with its streams |
| `GET /v1/streams` | All playable stream records |
| `GET /v1/countries` | Country index |
| `GET /v1/countries/:code` | Stations and streams for one country |
| `GET /v1/categories` | Category index |
| `GET /v1/categories/:id` | Stations and streams for one category |
| `GET /v1/languages` | Language index |
| `GET /v1/languages/:code` | Stations and streams for one language |

Country codes use lowercase ISO 3166-1 alpha-2 values in URLs. Language codes use the normalized language codes stored by AirwaveDB.

Examples:

```text
GET /v1/countries/jp
GET /v1/categories/news
GET /v1/languages/ja
GET /v1/stations/awb_0123456789abcdef0123
```

## Static JSON

The generated JSON files can also be consumed without the HTTP router:

```text
https://raw.githubusercontent.com/AirwaveDB/api/main/v1/index.json
https://raw.githubusercontent.com/AirwaveDB/api/main/v1/stations.json
https://raw.githubusercontent.com/AirwaveDB/api/main/v1/streams.json
https://raw.githubusercontent.com/AirwaveDB/api/main/v1/countries/jp.json
https://raw.githubusercontent.com/AirwaveDB/api/main/v1/categories/news.json
https://raw.githubusercontent.com/AirwaveDB/api/main/v1/languages/ja.json
```

NDJSON distributions are available at:

```text
/v1/stations.ndjson
/v1/streams.ndjson
```

## Station lookup

Station IDs are stable AirwaveDB identifiers. The routed API resolves a station ID to a single JSON object without requiring clients to download the full station dataset.

The generated lookup shards under `v1/_lookup/` are implementation details and are not part of the public API contract.

## Data model

A station is a radio service. A stream is one playable endpoint belonging to that station.

Station identity and metadata are maintained in [`AirwaveDB/database`](https://github.com/AirwaveDB/database). Stream endpoints are maintained in [`AirwaveDB/streams`](https://github.com/AirwaveDB/streams). Consumer-facing country, category, language, and station responses join both datasets.

## Deployment

`wrangler.toml` deploys `v1/` as static assets and `src/worker.js` provides the extensionless HTTP routes listed above.

```bash
npx wrangler deploy
```

## Updates

Generated files are rebuilt automatically from the current `database` and `streams` repositories. Generated files should not be edited manually.

## License

AirwaveDB's generated directory data is released under CC0 1.0. Third-party station names, logos, websites, stream endpoints, and broadcasts remain subject to their respective owners' rights.
