import { ExternalLink, MessageCircleQuestion } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

const GITHUB_REPO_URL = 'https://github.com/tarskia/tarskia';
const DIAGRAM_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new?template=diagram_issue.yml`;
const REPO_REQUEST_URL = `${GITHUB_REPO_URL}/issues/new?template=repo_request.yml`;

export function GalleryFeedbackMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open gallery feedback menu"
          title="Feedback"
        >
          <MessageCircleQuestion size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuItem asChild>
          <a
            href={DIAGRAM_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-between gap-3"
          >
            <span>Report diagram issue</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={REPO_REQUEST_URL}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-between gap-3"
          >
            <span>Request a repo</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
