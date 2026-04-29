# Contributing

Thanks for helping improve Tarskia.

## Useful Commands

```sh
npm ci
npm run build:semantics
npm run test -w @tarskia/diagram-semantics
npm run test -w @tarskia/frontend
npm run build -w @tarskia/frontend
```

## Pull Requests

- Keep changes scoped to the package or app that owns the behavior.
- Add or update tests when behavior changes.
- Do not hand-edit generated files under `frontend/src/api/generated/`.
- If API shapes change, update `openapi/tarskia-api.yaml` and regenerate the frontend client.

## Diagram Feedback

For incorrect gallery diagrams, open a diagram issue and include the repository,
diagram URL, and the specific missing or incorrect structure.
