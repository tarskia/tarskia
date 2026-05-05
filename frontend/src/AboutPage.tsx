import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GalleryFeedbackMenu } from './ui/GalleryFeedbackMenu';
import { GitHubLink } from './ui/GitHubLink';
import { ThemeToggle } from './ui/ThemeToggle';

const GITHUB_REPO_URL = 'https://github.com/tarskia/tarskia';
const DIAGRAM_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new?template=diagram_issue.yml`;
const REPO_REQUEST_URL = `${GITHUB_REPO_URL}/issues/new?template=repo_request.yml`;

export default function AboutPage() {
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-6 py-4">
          <Link
            to="/gallery"
            className="inline-flex shrink-0 items-center gap-2.5 text-lg font-semibold text-accent transition-colors hover:text-accent/80"
          >
            <img src="/tarskia-icon.svg" alt="" aria-hidden="true" className="h-7 w-7" />
            tarskia
          </Link>
          <span className="hidden shrink-0 rounded-md px-2.5 py-1 text-sm font-medium text-foreground sm:inline-flex">
            About
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <GalleryFeedbackMenu />
            <GitHubLink />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-[720px] px-6 py-14 sm:py-20">
          <header className="mb-10">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              About tarskia
            </p>
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Automated, maintainable architecture diagrams
            </h1>
          </header>

          <div className="space-y-4 text-base leading-7 text-muted-foreground">
            <p>
              Tarskia is an open-source toolkit for generating and maintaining architecture diagrams
              of software repositories. It's opinionated out of the box — core schemas for code, web
              apps, and data models ship as defaults — and configurable enough to swap or extend
              them where a repo needs something different.
            </p>
            <p>
              A tarskia diagram is code. Every box, group, and arrow in it has a type, and those
              types determine what it means and how it can be drawn, searched, and checked.
            </p>
            <p>
              The types themselves come from schemas — small, versioned vocabularies for a domain
              (code, web apps, data models, and so on). A diagram picks the schemas it needs and
              uses their types to describe a system.
            </p>
          </div>

          <Section title="How it's put together">
            <p>
              A diagram and the schemas it uses each carry their own properties — and together they
              are what make a tarskia diagram different from a picture.
            </p>

            <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
              Diagrams
            </h3>
            <ul className="mt-2 space-y-2 pl-5 [&>li]:list-disc [&>li]:marker:text-muted-foreground/60">
              <li>
                <span className="text-foreground">Versioned</span> — kept under source control,
                iterated on like any other code.
              </li>
              <li>
                <span className="text-foreground">Opinionated</span> — every entity, group, and
                relation conforms to a schema, so a diagram is a particular reading of a system, not
                a freeform sketch.
              </li>
              <li>
                <span className="text-foreground">Diffable</span> — plain YAML, so changes show up
                as readable diffs in code review.
              </li>
            </ul>

            <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
              Schemas
            </h3>
            <ul className="mt-2 space-y-2 pl-5 [&>li]:list-disc [&>li]:marker:text-muted-foreground/60">
              <li>
                <span className="text-foreground">Modular</span> — composable building blocks; a
                diagram pulls in only the schemas it needs.
              </li>
              <li>
                <span className="text-foreground">Versioned</span> — pinned like any other
                dependency, so a diagram and the vocabulary it speaks stay in sync.
              </li>
              <li>
                <span className="text-foreground">Expandable</span> — extend or replace to fit
                different kinds of repo, so a frontend monorepo and a data warehouse don't have to
                be flattened to the same primitives.
              </li>
            </ul>
            <p className="mt-4">
              Tarskia ships with core schemas — base, code, web-app, data-model — so there are
              opinions out the box, and they are configurable enough to swap or extend.
            </p>
          </Section>

          <Section title="Change management">
            <p>
              Both diagrams and schemas are versioned and diffable, so they can evolve as the
              systems they describe do. The longer-term aim is to automate that evolution: surface
              breaking schema changes against the diagrams that depend on them, and rebase diagrams
              onto newer schema versions where the changes are mechanical. The design is there; the
              execution is a work in progress.
            </p>
          </Section>

          <Section title="How diagrams are generated">
            <p>
              Diagrams in the gallery are produced by a multi-turn analysis loop. An AI coding agent
              reads the source repo, drafts an initial outline, and then iteratively expands it in
              increasing detail — adding entities, refining types, and validating against the schema
              after each pass.
            </p>
            <p>
              The output is plain YAML against a public schema, so a person can pick up the result,
              edit it, and push it back through the pipeline.
            </p>
          </Section>

          <Section title="The gallery">
            <p>
              The{' '}
              <Link to="/gallery" className="text-accent underline-offset-4 hover:underline">
                public gallery
              </Link>{' '}
              contains AI-generated, schema-validated diagrams for open-source repositories. Each
              one is built from public source at a captured commit, with node and token counts shown
              up front. They will sometimes miss or misclassify implementation details — please let
              us know when they do.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href={DIAGRAM_ISSUE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                >
                  Report a diagram issue
                </a>{' '}
                — anything wrong, missing, or misleading.
              </li>
              <li>
                <a
                  href={REPO_REQUEST_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                >
                  Request a repository
                </a>{' '}
                — point us at an open-source project you'd like to see in the gallery.
              </li>
            </ul>
          </Section>

          <Section title="What's open, what isn't">
            <p>
              The frontend, diagram renderer, curated gallery source, and shared diagram model live
              in the public repo. The generation worker and hosted backend are private.
            </p>
          </Section>

          <Section title="Getting involved">
            <p>
              Tarskia is small and early. The fastest way to help is to use it, find the rough
              edges, and let us know what's broken or missing. Pull requests, issues, and
              discussions are all welcome on{' '}
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
              >
                github.com/tarskia/tarskia
              </a>
              .
            </p>
          </Section>

          <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
            <Link
              to="/gallery"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to the gallery
            </Link>
          </footer>
        </article>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-4 text-base leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}
