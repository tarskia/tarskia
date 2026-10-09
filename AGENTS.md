# Tarskia Public Repo

## Project Overview

This repository contains the public, open-source parts of Tarskia:

- `frontend/`: Vite + React + TypeScript app for the public gallery viewer.
- `gallery/curated/`: source-of-truth curated gallery diagrams.
- `packages/diagram-semantics/`: shared semantic diagram model and validation package.
- `openapi/`: public API contract snapshot consumed by the generated frontend client.

The backend and diagram-generation worker are private repositories while the
worker pipeline is still experimental.

The frontend consumes `packages/diagram-semantics/src` directly through an alias; `dist/` is only for the package’s own build.

## Working Norms

- Keep frontend behavior in `frontend/` and shared semantic behavior in
  `packages/diagram-semantics/`.
- Treat `gallery/curated/` as the canonical gallery source. The private backend
  keeps a synced deployment snapshot.
- Prefer fixing shared semantic behavior in the package instead of duplicating
  logic in consumers.
- Match the local style and tooling of the area you touch.
- Do not hand-edit generated output unless explicitly requested.

## UI Notes

- Do not put round-edged pills around every button or piece of data. Prefer
  plain controls, links, or familiar icon buttons.

## Generated And Derived Files

Do not hand-edit generated output unless explicitly asked. Update the source and
regenerate instead.

Generated or derived locations include:

- `frontend/src/api/generated/`
- `frontend/dist/`
- `packages/diagram-semantics/dist/`

## Commands

- `npm run build`: build all npm workspaces.
- `npm run test`: run tests across npm workspaces.
- `npm run validate:schemas`: run frontend schema validation checks.

Frontend commands can also be run with `-w @tarskia/frontend`:

- `npm run dev -w @tarskia/frontend`
- `npm run build -w @tarskia/frontend`
- `npm run test -w @tarskia/frontend`
- `npm run lint -w @tarskia/frontend`
- `npm run generate:api -w @tarskia/frontend`

Semantic package commands:

- `npm run build -w @tarskia/diagram-semantics`
- `npm run test -w @tarskia/diagram-semantics`

## Validation Guidance

- Start with the narrowest validation that covers the change.
- For frontend changes, prefer the relevant Vitest suite or `npm run lint`.
- For shared semantic changes, run the semantic package tests and the dependent
  frontend checks that consume the changed behavior.
