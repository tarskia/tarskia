import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppHeader } from './AppHeader';

describe('AppHeader', () => {
  it('keeps diagram save actions out of the header', () => {
    const html = renderToStaticMarkup(
      <AppHeader
        diagramName="Payments"
        onDiagramNameChange={vi.fn()}
        diagramStatusLabel="Draft"
        accountEmail="ada@example.com"
        accountDisplayName="Ada Lovelace"
        onSignOut={vi.fn()}
        onRevertDiagramName={vi.fn()}
      />,
    );

    expect(html).toContain('Sign out');
    expect(html).toContain('src="/tarskia-icon.svg"');
    expect(html).toContain('ada@example.com');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Revert name');
    expect(html).not.toContain('Checkpoint');
    expect(html).not.toContain('Save as new');
    expect(html).not.toContain('Import YAML');
    expect(html).not.toContain('Download YAML');
    expect(html).not.toContain('New diagram');
  });

  it('renders a profile image when available for the authenticated account', () => {
    const html = renderToStaticMarkup(
      <AppHeader
        diagramName="Payments"
        onDiagramNameChange={vi.fn()}
        accountEmail="ada@example.com"
        accountDisplayName="Ada Lovelace"
        accountProfilePictureUrl="https://images.example.com/ada.png"
        onSignOut={vi.fn()}
      />,
    );

    expect(html).toContain('https://images.example.com/ada.png');
    expect(html).toContain('Ada Lovelace avatar');
  });

  it('renders persistent guest auth actions when no account is signed in', () => {
    const html = renderToStaticMarkup(
      <AppHeader
        diagramName="Payments"
        onDiagramNameChange={vi.fn()}
        onSignIn={vi.fn()}
        onSignUp={vi.fn()}
      />,
    );

    expect(html).toContain('Sign in');
    expect(html).toContain('Sign up');
    expect(html).not.toContain('Sign out');
  });

  it('keeps search status and reveal controls to the left of the search input', () => {
    const html = renderToStaticMarkup(
      <AppHeader
        diagramName="Payments"
        onDiagramNameChange={vi.fn()}
        searchQuery="orders"
        onSearchQueryChange={vi.fn()}
        onClearSearch={vi.fn()}
        searchTotalMatches={4}
        searchHiddenMatches={2}
        onRevealSearchResults={vi.fn()}
      />,
    );

    const summaryIndex = html.indexOf('4 matches, 2 hidden');
    const revealIndex = html.indexOf('>Reveal<');
    const searchIndex = html.indexOf('aria-label="Search diagram"');

    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(revealIndex).toBeGreaterThanOrEqual(0);
    expect(searchIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeLessThan(searchIndex);
    expect(revealIndex).toBeLessThan(searchIndex);
  });
});
