import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  getDiagramStream,
  getGetDiagramStreamQueryKey,
  useListDiagramStreams,
} from '../api/generated/diagrams/diagrams';
import {
  getGetSchemaStreamQueryKey,
  getSchemaStream,
  useListSchemaStreams,
} from '../api/generated/schemas/schemas';
import { createEmptyDiagramStoreSnapshot, type DiagramStoreSnapshot } from '../model/diagram-store';
import {
  createEmptyUserSchemaStoreSnapshot,
  type UserSchemaStoreSnapshot,
} from '../model/personal-schema-registry';
import { mapRemoteDiagramSnapshot, mapRemoteUserSchemaSnapshot } from './remote-mappers';

export interface RemoteWorkspaceState {
  diagramSnapshot: DiagramStoreSnapshot;
  isLoading: boolean;
  schemaSnapshot: UserSchemaStoreSnapshot;
}

export const useRemoteWorkspace = (enabled: boolean): RemoteWorkspaceState => {
  const diagramListQuery = useListDiagramStreams({
    query: {
      enabled,
      staleTime: 30_000,
    },
  });
  const schemaListQuery = useListSchemaStreams({
    query: {
      enabled,
      staleTime: 30_000,
    },
  });

  const diagramIds =
    diagramListQuery.data?.status === 200
      ? diagramListQuery.data.data
          .map((stream) => stream.id)
          .filter((streamId): streamId is string => Boolean(streamId))
      : [];
  const schemaNames =
    schemaListQuery.data?.status === 200
      ? schemaListQuery.data.data
          .map((stream) => stream.name)
          .filter((name): name is string => Boolean(name))
      : [];

  const diagramDetailQueries = useQueries({
    queries: diagramIds.map((streamId) => ({
      queryKey: getGetDiagramStreamQueryKey(streamId),
      queryFn: () => getDiagramStream(streamId),
      enabled,
      staleTime: 30_000,
    })),
  });
  const schemaDetailQueries = useQueries({
    queries: schemaNames.map((name) => ({
      queryKey: getGetSchemaStreamQueryKey(name),
      queryFn: () => getSchemaStream(name),
      enabled,
      staleTime: 30_000,
    })),
  });

  return useMemo(() => {
    const isDiagramListLoading = enabled && diagramListQuery.isPending;
    const isSchemaListLoading = enabled && schemaListQuery.isPending;
    const isDiagramDetailsLoading =
      enabled &&
      diagramIds.length > 0 &&
      diagramDetailQueries.some((query) => query.isPending || query.data?.status !== 200);
    const isSchemaDetailsLoading =
      enabled &&
      schemaNames.length > 0 &&
      schemaDetailQueries.some((query) => query.isPending || query.data?.status !== 200);

    const diagramSnapshot =
      enabled &&
      !isDiagramListLoading &&
      !isDiagramDetailsLoading &&
      diagramDetailQueries.every((query) => query.data?.status === 200)
        ? mapRemoteDiagramSnapshot(diagramDetailQueries.map((query) => query.data.data))
        : createEmptyDiagramStoreSnapshot();

    const schemaSnapshot =
      enabled &&
      !isSchemaListLoading &&
      !isSchemaDetailsLoading &&
      schemaDetailQueries.every((query) => query.data?.status === 200)
        ? mapRemoteUserSchemaSnapshot(schemaDetailQueries.map((query) => query.data.data))
        : createEmptyUserSchemaStoreSnapshot();

    return {
      diagramSnapshot,
      schemaSnapshot,
      isLoading:
        isDiagramListLoading ||
        isSchemaListLoading ||
        isDiagramDetailsLoading ||
        isSchemaDetailsLoading,
    };
  }, [
    diagramDetailQueries,
    diagramIds.length,
    diagramListQuery.isPending,
    enabled,
    schemaDetailQueries,
    schemaListQuery.isPending,
    schemaNames.length,
  ]);
};
