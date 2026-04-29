# Tarskia

Tarskia is a semantic architecture diagram system for inspecting software
repositories as structured, schema-validated diagrams.

This repository contains the open-source frontend, diagram renderer, curated
gallery source, and shared semantic model. The generation worker and production
backend are private while the worker pipeline is still experimental.

## What You Can Run Locally

The public gallery and renderer run from this repository without the private
backend. In local dev, the gallery loads checked-in YAML diagrams from
`gallery/curated` if the backend API is unavailable.

The studio UI is included, but persistence, auth, and hosted account features
depend on the private backend.

## Repository Layout

- `frontend/`: Vite + React + TypeScript app.
- `gallery/curated/`: source-of-truth curated gallery diagrams.
- `packages/diagram-semantics/`: semantic diagram model, parser, validator, and view helpers.
- `openapi/`: public API contract snapshot for the hosted backend.
- `scripts/`: shared build scripts.

## Quick Start

```sh
npm ci
npm run dev -w @tarskia/frontend
```

Open the Vite URL and go to `/gallery`.

## Backend Configuration

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

## Verification

```sh
npm run build:semantics
npm run test -w @tarskia/diagram-semantics
npm run test -w @tarskia/frontend
npm run build -w @tarskia/frontend
```

## API Client

The generated frontend client is based on `openapi/tarskia-api.yaml`.

```sh
npm run generate:api -w @tarskia/frontend
```

## Feedback

Use GitHub issues to report incorrect diagram details or request a repository for
the gallery. The hosted gallery links to prefilled issue forms for both flows.
