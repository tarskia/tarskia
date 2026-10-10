# Diagram Worker

This repo is the repo-to-diagram worker for the semantic diagram project.

## Project context

The wider project is an opinionated semantic architecture diagrammer. It is not a generic whiteboarding tool. Diagrams are meant to describe software systems in terms of schema-defined architectural concepts such as applications, services, APIs, code modules, datastores, queues, and their relationships.

The source of truth for the semantic model lives in the public Tarskia repository's
`packages/diagram-semantics/` package. This repository keeps a pinned copy of that
package for the worker.

## What this worker does

The worker analyzes a git repository and produces a semantic diagram YAML document that the frontend can load and inspect.

Current flow:

1. Prepare a job workspace.
2. Clone the target repo into `target-repo/`.
3. Copy the schema source repo into `schema-repo/`.
4. Build a prompt package from the live schema registry plus the worker contract.
5. Use the Codex TypeScript SDK to inspect the repo and draft a semantic document.
6. Validate the result deterministically against the copied semantic kernel.
7. If validation fails, run bounded repair passes with diagnostics.
8. Write the final validated YAML artifact.

The worker is responsible for:

- workspace preparation
- git clone and revision capture
- prompt construction
- Codex SDK orchestration
- deterministic validation
- provenance requirements for generated entities and relations
- prompt/debug artifacts in the job workspace

The worker is not the source of truth for the semantic model. The shared
`packages/diagram-semantics/` package is synced from the public repository, with
its source revision recorded in `packages/diagram-semantics/UPSTREAM`.
Worker-local semantic adapters live under `src/semantic/`.

## Important architectural constraints

- Prefer deterministic validation over prompt-only enforcement.
- Treat the model output as a candidate artifact, not authority.
- Provenance is mandatory for worker-generated entities and relations.
- Provenance paths must be repo-relative.
- Document inputs identify repos/revisions; provenance points into those inputs.
- For now, assume GitHub-style remotes when building provenance links in the frontend.
- Prefer shipped/runtime architecture over build tooling, test code, local dev helpers, and dev-only endpoints.
- Keep the worker provider-facing surface narrow. Codex SDK usage should stay behind the local agent adapter.

## Repo structure

- `src/cli.ts`: CLI entrypoint
- `src/build-diagram.ts`: end-to-end orchestration
- `src/repository-service.ts`: repo/workspace preparation and repo metadata resolution
- `src/ai-diagram-service.ts`: AI drafting, repair, validation, and prompt/debug artifacts
- `src/logger.ts`: logger interface and default console logger
- `src/workspace.ts`: job workspace preparation
- `src/codex/`: prompt building and Codex SDK adapter
- `src/semantic/model/` and `src/semantic/util/`: compatibility re-exports of the shared semantic package
- `src/semantic/`: worker-local schema loading/runtime adapters and bundled schema assets
- `test/fixtures/`: worker fixture repos and schemas

## Editing guidance

- Fix shared semantic behavior in the public source repository and sync its package; do not hand-edit the copied kernel.
- Keep filesystem loading and other worker-specific integration in the local adapters.
- If you change prompt contract behavior here, keep tests updated so the rendered contract stays intentional.
- Do not relax validation just to make model output pass.
- Prefer small, explicit prompt-policy changes over vague prompt expansion.
- This app is still pre-release. Breaking internal changes are acceptable if tests and fixtures are updated accordingly.
