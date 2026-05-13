import { Button } from '../components/ui/button';

const GITHUB_REPO_URL = 'https://github.com/tarskia/tarskia';

export function GitHubLink() {
  return (
    <Button
      asChild
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="View tarskia on GitHub"
      title="View tarskia on GitHub"
    >
      <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
        <GitHubMark />
      </a>
    </Button>
  );
}

function GitHubMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      role="img"
    >
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.96 3.21 9.16 7.66 10.65.56.1.77-.24.77-.54 0-.27-.01-.97-.02-1.9-3.12.68-3.78-1.5-3.78-1.5-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.49-.28-5.11-1.25-5.11-5.55 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.97 0 0 .94-.3 3.08 1.15A10.7 10.7 0 0 1 12 6.84c.95.01 1.92.13 2.82.38 2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.69.11 2.97.72.79 1.16 1.79 1.16 3.02 0 4.31-2.63 5.27-5.13 5.55.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.06 0 .3.2.65.78.54 4.45-1.49 7.66-5.69 7.66-10.65C23.25 5.48 18.27.5 12 .5Z" />
    </svg>
  );
}
