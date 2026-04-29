import { useMemo } from 'react';

import { useGetMe } from '../api/generated/auth/auth';
import type {
  DtoMemberResponse,
  DtoMeResponse,
  DtoOrganizationResponse,
} from '../api/generated/model';

export type SessionMode = 'guest' | 'authenticated' | 'loading';

export interface AuthenticatedSession {
  mode: 'authenticated';
  member: DtoMemberResponse;
  organization: DtoOrganizationResponse;
  principalId: string;
}

export interface GuestSession {
  mode: 'guest';
}

export interface LoadingSession {
  mode: 'loading';
}

export type AppSession = AuthenticatedSession | GuestSession | LoadingSession;
export interface AppSessionState {
  session: AppSession;
  backendAvailable: boolean;
}

export const isAuthenticatedPayload = (
  payload: DtoMeResponse | undefined,
): payload is DtoMeResponse & {
  member: DtoMemberResponse & { principalId: string };
  organization: DtoOrganizationResponse;
} => Boolean(payload?.member?.id && payload.member.principalId && payload.organization?.id);

const isGuestForced = () => import.meta.env.VITE_FORCE_GUEST_MODE === 'true';

export const isBackendAvailableResponse = (params: {
  forceGuest: boolean;
  responseStatus?: number;
  error?: unknown;
}) => {
  const { forceGuest, responseStatus, error } = params;
  if (forceGuest) {
    return true;
  }
  if (error) {
    return false;
  }
  if (typeof responseStatus === 'number') {
    return responseStatus < 500;
  }
  return true;
};

export const useAppSessionState = (): AppSessionState => {
  const forceGuest = isGuestForced();
  const meQuery = useGetMe({
    query: {
      enabled: !forceGuest,
      staleTime: 60_000,
    },
  });

  return useMemo(() => {
    const backendAvailable = isBackendAvailableResponse({
      forceGuest,
      responseStatus: meQuery.data?.status,
      error: meQuery.error,
    });

    if (forceGuest) {
      return {
        session: { mode: 'guest' } satisfies GuestSession,
        backendAvailable,
      } satisfies AppSessionState;
    }

    if (meQuery.isPending) {
      return {
        session: { mode: 'loading' } satisfies LoadingSession,
        backendAvailable,
      } satisfies AppSessionState;
    }

    if (meQuery.data?.status === 200 && isAuthenticatedPayload(meQuery.data.data)) {
      return {
        session: {
          mode: 'authenticated',
          member: meQuery.data.data.member,
          organization: meQuery.data.data.organization,
          principalId: meQuery.data.data.member.principalId,
        } satisfies AuthenticatedSession,
        backendAvailable,
      } satisfies AppSessionState;
    }

    return {
      session: { mode: 'guest' } satisfies GuestSession,
      backendAvailable,
    } satisfies AppSessionState;
  }, [forceGuest, meQuery.data, meQuery.error, meQuery.isPending]);
};

export const useAppSession = (): AppSession => {
  const { session } = useAppSessionState();
  return session;
};
