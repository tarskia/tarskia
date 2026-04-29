# Tarskia

Tarskia is a semantic architecture diagram system. This repository contains the
open-source frontend, gallery/studio renderer, and the shared semantic model used
to validate and render diagrams.

The public gallery shows AI-generated, schema-validated diagrams for open-source
repositories. The generation worker and production backend are private while the
worker pipeline is still experimental.

## Repository Layout

- `frontend/`: Vite + React + TypeScript app.
- `gallery/curated/`: source-of-truth curated gallery diagrams.
- `packages/diagram-semantics/`: semantic diagram model, parser, validator, and view helpers.
- `openapi/`: public API contract snapshot for the hosted backend.
- `scripts/`: shared build scripts.

## Development

```sh
npm ci
npm run build:semantics
npm run test -w @tarskia/diagram-semantics
npm run test -w @tarskia/frontend
npm run build -w @tarskia/frontend
```

Run the local frontend:

```sh
npm run dev -w @tarskia/frontend
```

Set `VITE_API_BASE_URL` to point the frontend at a backend API. If it is not set,
the Vite dev server proxies API paths to `http://localhost:8082`. The public
gallery falls back to the checked-in YAML files during local dev when that API is
not available.

## Gallery

Curated gallery source files live in `gallery/curated`. The private backend keeps
a copied snapshot for deployment and embeds that snapshot into its Render-built
Docker image.

Force local gallery data without trying the API:

```sh
VITE_GALLERY_SOURCE=local npm run dev -w @tarskia/frontend
```

## API Client

The generated frontend client is based on `openapi/tarskia-api.yaml`.

```sh
npm run generate:api -w @tarskia/frontend
```

## Feedback

Use GitHub issues to report incorrect diagram details or request a repository for
the gallery. The hosted gallery links to prefilled issue forms for both flows.
