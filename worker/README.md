# Tarskia CLI Worker

Tarskia CLI analyzes a git repository and writes a semantic architecture diagram as a YAML file. The Tarskia gallery viewer can't open your own diagrams yet.

The worker is intentionally opinionated. It models software architecture with schema-defined concepts such as applications, services, APIs, modules, datastores, queues, and their relationships. It is not a generic diagramming or whiteboarding tool.

## Requirements

- Node.js 22 or newer
- npm
- git
- A Codex sign-in. The CLI uses your own Codex login and configuration; run
  `npx codex login` from this directory if you aren't signed in.
- `uv` is optional and only used by advanced Graphify hints mode (verified with uv 0.11.26).

## Usage

Run `npm ci` from the repository root first, then from this directory:

```sh
npm run build
node dist/cli.js check
node dist/cli.js build <repo-path-or-git-url> --out diagram.yaml
```

Useful options:

```sh
node dist/cli.js build <repo> --out diagram.yaml --mode advanced
node dist/cli.js build <repo> --out diagram.yaml --ref <git-ref>
node dist/cli.js build <repo> --out diagram.yaml --model gpt-6-luna --reasoning-effort max
node dist/cli.js build <repo> --out diagram.yaml --graphify-hints off
node dist/cli.js validate assets/schemas --kind schema-registry
node dist/cli.js validate diagram.yaml --kind diagram --schema-source assets/schemas
```

`--model` accepts any model ID supported by Codex for your sign-in method and
account; the worker has no model allowlist. For example, current model families
include `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`,
`gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. Model availability and
supported efforts are controlled by Codex, your account and the selected model.
See [Codex models](https://learn.chatgpt.com/docs/models) for current availability.

The worker pins Codex SDK and its CLI runtime to the same release. It exposes all
reasoning effort values in that SDK: `minimal`, `low`, `medium`, `high`, `xhigh`,
`max`, `ultra`, and `persistent`. Omitted effort defaults to `medium`. The API's
`none` effort is not an option in this Codex SDK. Luna supports up to `max`;
select newer efforts only for models that support them. The selected effort applies
to schema generation, diagram generation, repairs and reviews. The model must support the chosen effort. Job metadata and
the output document's `metadata.workerBuild` record the effort for the current run.
When continuing a job, the current invocation's effort applies to remaining turns;
completed checkpoints are reused.

From the worker directory, Taskfile build commands also accept `REASONING_EFFORT`
and default to `MODEL=gpt-6-luna`:

```sh
task overwrite REPO=owner/repo MODEL=gpt-6-luna REASONING_EFFORT=max
task continue REPO=owner/repo MODEL=gpt-6-luna REASONING_EFFORT=max
```

To run multiple builds at once, build the CLI once first and launch each
`node dist/cli.js build ...` command in a separate terminal. Give each repo a
unique `--out` and `--schema-out` path; its job directory is derived from `--out`.
The CLI uses bundled schemas when `--schema-source` is omitted. Local git inputs
use committed revisions and warn when local changes are omitted. New job roots
contain a `.gitignore` with `*`; existing ignore rules are preserved. Repeating a compatible interrupted advanced build
resumes its checkpoints. `--overwrite` only permits replacing existing output files;
it keeps checkpoints. Use `--fresh` to discard checkpoints and caches and rebuild
from scratch. `--fresh` does not permit replacing existing outputs: add
`--overwrite` too when needed. The `task overwrite` convenience command passes
both flags.

In advanced mode, `--stop-after level0-backbone` or `--stop-after level0-review`
writes `diagram.partial.yaml` for `--out diagram.yaml` and records the job as
`stopped`. Without an extension, the partial filename ends in `.partial.yaml`.
The final output stays untouched. A later plain run continues the checkpoint,
writes the final output, and deletes the partial file.

`--restart-from <stage>` re-runs that stage and subsequent stages, including
`level0-review` and `final-review`. Restarting a successful job permits replacing
its output without `--overwrite`. Restart requires an existing compatible
advanced job; restart and stop flags are usage errors in basic mode.

Ctrl-C or SIGTERM cancels active work and marks the job `interrupted`; rerun the
same advanced build to resume its checkpoints. Exit codes are 130 and 143,
respectively. A second signal exits immediately. Each job root has an exclusive
`.lock` containing its process ID, host and start time. Concurrent builds fail;
a dead process's lock on the same host is recovered with a warning. Foreign-host
or unreadable locks are never stolen. If a process crashes during stale-lock
recovery, inspect the reported `.lock.reclaim` file and remove it only after
confirming that no build is using that job.

With `--schema-out`, the default ID is `repo/<directory-or-repository-name>`.
Use `--schema-id repo/<name>` (or just `<name>`) to choose another slug; owners
other than `repo` are rejected. Building the filesystem root requires an explicit
ID. A generated ID must not already exist in the source registry; resuming the
same job can reuse its own generated module.

New generated schemas are installed alongside the copied registry's schemas,
under an owner directory, so bundled core modules remain available. Existing
installed modules keep their paths when reused.

Resume compares per-stage input fingerprints. Schema-source revisions (or YAML
content for unversioned sources) automatically restart area planning and later
stages. Changing `--max-depth` restarts refinement and clears its cache; changing
`--graphify-hints` restarts census/Graphify and later stages. CLI or checkpoint
format changes recompute everything. Accepted checkpoints are validated and
reused without repair turns. Model and effort changes apply to remaining stages;
metadata records each stage's settings and the output's `metadata.workerBuild`
lists distinct values in stage order.

Bundled schema revisions use the package version and a hash of asset names and
contents, independent of the enclosing Git repository. Bundled schemas and
ontology are loaded only from the installed package; missing assets are errors,
even when the working directory contains similarly named files.

## Process

The advanced worker flow is staged so intermediate outputs can be inspected and resumed:

1. Prepare a job workspace and resolve repository metadata.
2. Clone or copy the target repository into an isolated job directory.
3. Load bundled or supplied semantic schemas.
4. Build a repository census and optional Graphify hint summary.
5. Prepare the prompt contract.
6. Build an area plan and level-0 backbone.
7. Refine nodes breadth-first.
8. Collate the graph, run final review, and compile the validated bundle.

All generated diagram output is treated as a candidate until it passes deterministic validation.

## Security Notes

- Codex agent turns run with a read-only sandbox, no network access for the commands Codex runs, web search disabled and no approval escalation. Codex otherwise uses your own Codex configuration.
- Before analysis, Tarskia removes the clone's git history and masks secrets it recognises (using secretlint) in its working copy. Your repository is never modified. The output diagram is checked the same way.
- Worker-generated entities and relations must include repo-relative provenance.
- Git inputs are checked before clone/fetch operations, and Git subprocesses run with a reduced environment.
- Advanced Graphify hints mode executes static Graphify extraction outside the Codex sandbox. The shipped `build-graphify-hints.py.lock` pins Graphify 0.6.7 and its complete Python dependency set, including distribution hashes across Python >=3.10. The worker copies this lock beside its script and runs `uv run --no-config --isolated --locked --no-build --script`; it never loads script assets from the working directory. `--no-config` disables project/ancestor/user configuration discovery. Only prebuilt distributions are installed: `--no-build` prevents unpinned build backends from running for source distributions. Platforms without compatible wheels skip Graphify in `auto` mode and fail with a diagnostic in `required` mode. Inline scripts are already isolated in uv 0.11.26 (`--isolated` is a harmless no-op). Use `--graphify-hints off` to disable this optional step.
- To deliberately update the Graphify dependency lock, run `uv lock --no-config --default-index https://pypi.org/simple --script worker/src/advanced/build-graphify-hints.py` from the repository root and review the generated lock. Test static extraction without model calls with `TARSKIA_GRAPHIFY_INTEGRATION=1 npm exec -w worker -- vitest run src/advanced/graphify-hints.test.ts`.

### Token accounting

`approxTotalTokens` is input plus output tokens. Cached input is a subset of input,
not an extra charge in this count; `nonCachedInputTokens` is input minus cached
input. `reasoningOutputTokens` exposes the reasoning subset of output without
adding it again. These are token counts, not a dollar estimate.

For the pinned Codex SDK/CLI 0.162.0, completed-turn JSONL events contain cumulative
thread usage, despite the SDK type comments describing per-turn usage. The worker
persists `usageAccounting` in `out/job-metadata.json`: running totals and the last
reported counters keyed by thread ID. Resumed jobs reuse those baselines, and
reported usage is saved before output parsing or validation can fail. The final
build summary includes all reported model usage in the job, including schema
preparation.

Failed/interrupted SDK terminal events do not include usage. The worker retains
any usage already reported before a transport failure or timeout, and a subsequent
cumulative report can account for otherwise unreported attempts. Without such a
report, their cost is unknown; no usage is invented. Jobs created before these
baselines were recorded cannot separate historical thread usage from the first
new cumulative report. `approxTotalTokens` therefore remains approximate.

### Deterministic performance benchmarks

These opt-in tests run real advanced orchestration, validation and atomic writes
with canned agent adapters; they never call a model. The default suite skips them.
From the repository root, first run `npm run build:semantics`, then:

```sh
TARSKIA_PERFORMANCE_BENCHMARK=1 npm exec -w worker -- vitest run src/advanced/performance.benchmark.test.ts --maxWorkers=1
TARSKIA_PERFORMANCE_BENCHMARK=1 TARSKIA_BENCHMARK_CENSUS=1 npm exec -w worker -- vitest run src/advanced/performance.benchmark.test.ts -t 'census of' --maxWorkers=1
```

The pipeline cases grow connected diagrams to 50, 200 and 800 nodes using 6, 25
and 100 canned refinement turns, within unchanged production budgets. Reports
include total wall time, bytes written per turn, write counts and semantic output
hashes. Fixed startup overhead and concurrent machine activity affect timings;
there are no timing thresholds. Set `TARSKIA_BENCHMARK_N=200` to select a case and
`TARSKIA_BENCHMARK_REPORT=/tmp/tarskia-benchmark.jsonl` to append JSON reports.

Run the census separately for comparable process peak RSS. It creates 50,000
small files plus one 200 MiB file in a temporary directory, measures the complete
census, and removes the fixture afterward. Census and diagram hashes assert
unchanged deterministic content; only variable repository inputs, build metadata,
fixture roots and generation timestamps are excluded from the relevant hashes.

### Build allowance and turn timeouts

There is no default build-turn or refinement-work-item limit. Refinement continues
until its queue empties or `--max-depth` (default 8) is reached. Legacy checkpoint
turn/work-item limits are ignored on resume. Every turn uses your Codex account's
model usage, and large repositories can take many turns; use `--max-turns` to cap
an invocation.

`--max-turns <n>` optionally limits **all Codex SDK turns in this invocation**,
including schema generation, repairs, and timeout retries. At exhaustion the
worker checkpoints, writes `<out>.partial.yaml` (never replacing the final output),
sets job status `budget-exhausted`, and exits successfully. Run the same command
again for a fresh allowance and checkpoint resume. A partial created before an
accepted diagram exists can contain no entities; it is not a validated final result.

`--turn-timeout <minutes>` overrides the per-turn timeout; `0` disables it.
Defaults are 5 minutes for minimal/low/medium, 15 for high/xhigh, and 30 for
max/ultra/persistent effort. A timed-out turn is retried at most once on a fresh
thread, restoring advanced-stage context from its handoff artifact. A caller
without a handoff retains its thread for that one retry rather than losing context.
