import { Redo2, RotateCcw, Search, Undo2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { GitHubLink } from './GitHubLink';
import { ThemeToggle } from './ThemeToggle';

interface AppHeaderProps {
  diagramName?: string;
  onDiagramNameChange?: (name: string) => void;
  diagramNameReadOnly?: boolean;
  diagramStatusLabel?: string;
  accountEmail?: string;
  accountDisplayName?: string;
  accountProfilePictureUrl?: string;
  onSignIn?: () => void;
  onSignUp?: () => void;
  onSignOut?: () => void;
  onRevertDiagramName?: () => void;
  showBottomBorder?: boolean;
  // Document actions (undo/redo)
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // Search
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onClearSearch?: () => void;
  searchTotalMatches?: number;
  searchHiddenMatches?: number;
  onRevealSearchResults?: () => void;
}

export function AppHeader({
  diagramName,
  onDiagramNameChange,
  diagramNameReadOnly = false,
  diagramStatusLabel,
  accountEmail,
  accountDisplayName,
  accountProfilePictureUrl,
  onSignIn,
  onSignUp,
  onSignOut,
  onRevertDiagramName,
  showBottomBorder = true,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  searchQuery,
  onSearchQueryChange,
  onClearSearch,
  searchTotalMatches = 0,
  searchHiddenMatches = 0,
  onRevealSearchResults,
}: AppHeaderProps) {
  const hasGuestAuthActions = Boolean(onSignIn || onSignUp);
  const accountLabel = accountDisplayName?.trim() || accountEmail?.trim() || '';
  const avatarInitials = getAvatarInitials(accountDisplayName, accountEmail);
  const hasSearch = onSearchQueryChange !== undefined;
  const hasUndoRedo = onUndo !== undefined;
  const trimmedQuery = searchQuery?.trim() ?? '';

  return (
    <header
      className={`flex items-center gap-4 px-4 h-16 bg-background z-50 shrink-0 ${
        showBottomBorder ? 'border-b border-border' : ''
      }`}
    >
      {/* Brand */}
      <Link
        to="/gallery"
        className="inline-flex items-center gap-2.5 font-semibold text-lg tracking-wide text-accent shrink-0 transition-colors hover:text-accent/80"
      >
        <img src="/tarskia-icon.svg" alt="" aria-hidden="true" className="h-7 w-7" />
        <span className="text-accent">tarskia</span>
      </Link>
      <Link
        to="/about"
        className="hidden shrink-0 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground sm:inline-flex"
      >
        About
      </Link>
      <div className="w-px h-6 bg-border" />

      {/* Document context: name + undo/redo + status */}
      <div className="flex items-center gap-2 min-w-0">
        {diagramName !== undefined && (
          <>
            <Input
              className={`min-w-[140px] max-w-[260px] truncate bg-transparent px-1.5 py-1 text-sm font-medium ${
                diagramNameReadOnly
                  ? 'cursor-default border-transparent'
                  : 'border-transparent hover:border-border'
              }`}
              type="text"
              aria-label="Diagram name"
              value={diagramName}
              readOnly={diagramNameReadOnly}
              onChange={(e) => onDiagramNameChange?.(e.target.value)}
              spellCheck={false}
            />
            {onRevertDiagramName && (
              <Button variant="ghost" size="icon" onClick={onRevertDiagramName} title="Revert name">
                <RotateCcw size={13} />
              </Button>
            )}
          </>
        )}

        {hasUndoRedo && (
          <>
            <div className="w-px h-4 bg-border" />
            <div className="inline-flex items-center gap-px rounded-md border border-border bg-surface/50 p-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo (\u2318Z)"
              >
                <Undo2 size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (\u2318\u21e7Z)"
              >
                <Redo2 size={14} />
              </Button>
            </div>
          </>
        )}

        {diagramStatusLabel && (
          <span className="text-xs text-muted-foreground whitespace-nowrap ml-1">
            {diagramStatusLabel}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      {hasSearch && (
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex items-center justify-end gap-2">
            {trimmedQuery ? (
              <span className="truncate whitespace-nowrap text-[11px] text-muted-foreground">
                {searchTotalMatches === 0
                  ? 'No matches'
                  : `${searchTotalMatches} match${searchTotalMatches === 1 ? '' : 'es'}${
                      searchHiddenMatches > 0 ? `, ${searchHiddenMatches} hidden` : ''
                    }`}
              </span>
            ) : null}
            {onRevealSearchResults && searchHiddenMatches > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRevealSearchResults}
                className="h-7 border border-info/30 bg-info/15 px-2 text-info hover:bg-info/25 hover:text-info"
              >
                Reveal
              </Button>
            ) : null}
          </div>
          <div className="relative w-56 shrink-0">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              value={searchQuery ?? ''}
              onChange={(event) => onSearchQueryChange!(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  onClearSearch?.();
                }
                if (event.key === 'Enter' && onRevealSearchResults && searchHiddenMatches > 0) {
                  event.preventDefault();
                  onRevealSearchResults();
                }
              }}
              placeholder="Search diagram"
              aria-label="Search diagram"
              className="h-7 bg-background/75 pl-8 pr-8 text-xs placeholder:text-muted-foreground/70"
            />
            {trimmedQuery ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClearSearch}
                className="absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                aria-label="Clear diagram search"
                title="Clear search"
              >
                <X size={12} />
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* GitHub + Theme */}
      <GitHubLink />
      <ThemeToggle />

      {/* Account */}
      <div className="flex items-center gap-2">
        {accountEmail && onSignOut ? (
          <div className="flex items-center gap-2 rounded-lg px-2 py-1 bg-surface-hover/50">
            {accountProfilePictureUrl ? (
              <img
                src={accountProfilePictureUrl}
                alt={accountLabel ? `${accountLabel} avatar` : 'Account avatar'}
                className="h-7 w-7 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold uppercase tracking-wide text-foreground">
                {avatarInitials}
              </div>
            )}
            <div className="hidden min-w-0 md:flex md:flex-col md:items-end">
              {accountDisplayName ? (
                <span className="max-w-[160px] truncate text-xs font-medium text-foreground">
                  {accountDisplayName}
                </span>
              ) : null}
              <span className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                {accountEmail}
              </span>
            </div>
            <Button variant="outline" onClick={onSignOut} title="Sign out">
              Sign out
            </Button>
          </div>
        ) : hasGuestAuthActions ? (
          <div className="flex items-center gap-1.5">
            {onSignIn ? (
              <Button variant="ghost" onClick={onSignIn} title="Sign in">
                Sign in
              </Button>
            ) : null}
            {onSignUp ? (
              <Button variant="accent" onClick={onSignUp} title="Sign up">
                Sign up
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function getAvatarInitials(displayName?: string, email?: string) {
  const source = displayName?.trim() || email?.trim() || '?';
  const words = source
    .replace(/[@._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return '?';
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
}
