import { describe, expect, it } from 'vitest';

import type { DtoMeResponse } from '../api/generated/model';
import { isAuthenticatedPayload, isBackendAvailableResponse } from './useAppSession';

describe('useAppSession authentication payload detection', () => {
  it('accepts a generic authenticated /me payload without provider-specific fields', () => {
    const payload: DtoMeResponse = {
      member: {
        id: 'member_123',
        principalId: 'principal_123',
        organizationId: 'org_123',
        email: 'ada@example.com',
        createdAt: '2026-04-04T10:00:00Z',
        updatedAt: '2026-04-04T10:00:00Z',
        lastSeenAt: '2026-04-04T10:00:00Z',
      },
      organization: {
        id: 'org_123',
        createdAt: '2026-04-04T10:00:00Z',
        updatedAt: '2026-04-04T10:00:00Z',
      },
    };

    expect(isAuthenticatedPayload(payload)).toBe(true);
  });

  it('treats unauthorized guest responses as backend-available', () => {
    expect(
      isBackendAvailableResponse({
        forceGuest: false,
        responseStatus: 401,
      }),
    ).toBe(true);
  });

  it('treats server failures as backend-unavailable', () => {
    expect(
      isBackendAvailableResponse({
        forceGuest: false,
        responseStatus: 502,
      }),
    ).toBe(false);
  });

  it('treats transport errors as backend-unavailable', () => {
    expect(
      isBackendAvailableResponse({
        forceGuest: false,
        error: new TypeError('fetch failed'),
      }),
    ).toBe(false);
  });

  it('keeps backend features optimistic when guest mode is forced', () => {
    expect(
      isBackendAvailableResponse({
        forceGuest: true,
        responseStatus: 502,
      }),
    ).toBe(true);
  });
});
