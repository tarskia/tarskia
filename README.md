# Tarskia

[Tarskia](https://tarskia.io). is an open-source toolkit for generating and maintaining architecture
diagrams of software repositories. Diagrams are code: every entity has a type,
types come from versioned schemas, and the result is plain YAML that fits into
normal source control.

This repository contains the frontend, diagram renderer, curated gallery
source, and shared diagram model. The generation worker and hosted backend are
private.

## To come

- Worker to let you build your own diagrams - on a bring-your-own-key basis
- Diagram diffs: confirm that the AI only broke the thing you asked it to change
- GitHub integration to keep your diagrams fresh
- Studio for diagram editing, management, and cloud saves and sharing

## What You Can Run Locally

The public gallery and renderer run from this repository without the private
backend. In local dev, the gallery loads checked-in YAML diagrams from
`gallery/curated` if the backend API is unavailable.

The studio UI is included, but persistence, auth, and hosted account features
depend on the private backend.

## Repository Layout

- `frontend/`: Vite + React + TypeScript app.
- `gallery/curated/`: source-of-truth curated gallery diagrams.
- `packages/diagram-semantics/`: shared diagram model — parser, validator, and view helpers.
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
the Vite dev server proxies API paths to `http://localhost:8082`, but the public
gallery uses the checked-in YAML files during local dev by default. Set
`VITE_GALLERY_SOURCE=api` when you want the gallery to use the backend API.

## Gallery

Curated gallery source files live in `gallery/curated`. The private backend keeps
a copied snapshot for deployment and embeds that snapshot into its Render-built
Docker image.

Force local gallery data explicitly:

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
