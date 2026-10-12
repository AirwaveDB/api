# AirwaveDB API

Public JSON API for the AirwaveDB internet radio directory.

AirwaveDB indexes internet radio stations and their playable stream endpoints. This repository publishes generated, read-only JSON and NDJSON files for applications and data consumers.

## Base URL

The API is available directly from GitHub:

```text
https://raw.githubusercontent.com/AirwaveDB/api/main/v1
```

Example:

```text
https://raw.githubusercontent.com/AirwaveDB/api/main/v1/countries/jp.json
```

## Endpoints

| Endpoint | Description |
| --- | --- |
| `/index.json` | Dataset counts and build timestamps |
| `/stations.json` | All station metadata |
| `/streams.json` | All playable stream records |
| `/stations.ndjson` | One station JSON object per line |
| `/streams.ndjson` | One stream JSON object per line |
| `/countries.json` | Country index |
| `/languages.json` | Language index |
| `/categories.json` | Category index |
| `/countries/<cc>.json` | Stations and streams for one country |

Country filenames use lowercase ISO 3166-1 alpha-2 codes.

Examples:

```text
GET /index.json
GET /countries/jp.json
GET /countries/us.json
GET /categories.json
```

```bash
curl https://raw.githubusercontent.com/AirwaveDB/api/main/v1/countries/jp.json
```

```js
const response = await fetch(
  'https://raw.githubusercontent.com/AirwaveDB/api/main/v1/countries/jp.json'
)
const data = await response.json()
```

## Data model

A station is the radio service itself. A stream is one playable URL belonging to that station.

Station identity and metadata are maintained in [`AirwaveDB/database`](https://github.com/AirwaveDB/database). Stream endpoints are maintained in [`AirwaveDB/streams`](https://github.com/AirwaveDB/streams). Country endpoints join both datasets into one document for clients.

## Updates

Generated files are rebuilt automatically from the current `database` and `streams` repositories. Generated files should not be edited manually.

## License

AirwaveDB's generated directory data is released under CC0 1.0. Third-party station names, logos, websites, stream endpoints, and broadcasts remain subject to their respective owners' rights.