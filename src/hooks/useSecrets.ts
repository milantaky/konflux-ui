import React from 'react';
import {
  K8S_SECRET_PARTIAL_OBJECT_METADATA_ACCEPT,
  K8S_SECRET_PARTIAL_OBJECT_METADATA_LIST_ACCEPT,
} from '~/consts/secrets';
import { useK8sWatchResource } from '../k8s';
import { SecretGroupVersionKind, SecretModel } from '../models';
import { SecretKind } from '../types';

/** Refetch interval when WebSocket watch is disabled (PartialObjectMetadataList). */
const SECRETS_LIST_REFETCH_MS = 30_000;

const secretListPartialMetadataFetchOptions = {
  requestInit: {
    headers: { Accept: K8S_SECRET_PARTIAL_OBJECT_METADATA_LIST_ACCEPT },
  },
};

const secretGetPartialMetadataFetchOptions = {
  requestInit: {
    headers: { Accept: K8S_SECRET_PARTIAL_OBJECT_METADATA_ACCEPT },
  },
};

/** React Query key for one-off full Secret GET (edit flow / submit merge). */
export const getSecretFullQueryKey = (namespace: string, secretName: string) =>
  ['SecretFull', namespace, secretName] as const;

/**
 * Lists Secrets with metadata-only items (`PartialObjectMetadataList` Accept header). WebSocket
 * watch stays disabled because the browser cannot send that `Accept` on the watch handshake.
 */
export const useSecrets = (namespace: string): [SecretKind[], boolean, unknown] => {
  const {
    data: secrets,
    isLoading,
    error,
  } = useK8sWatchResource<SecretKind[]>(
    {
      groupVersionKind: SecretGroupVersionKind,
      namespace,
      isList: true,
      watch: false,
      partialMetadata: true,
    },
    SecretModel,
    {
      enabled: !!namespace,
      refetchInterval: SECRETS_LIST_REFETCH_MS,
    },
    secretListPartialMetadataFetchOptions,
  );

  return React.useMemo(
    () => [
      !isLoading && !error ? secrets?.filter((rs) => !rs.metadata.deletionTimestamp) : [],
      !isLoading,
      error,
    ],
    [secrets, isLoading, error],
  );
};

export const useSecret = (
  namespace: string,
  name: string,
): [SecretKind | undefined, boolean, unknown] => {
  const {
    data: secret,
    isLoading,
    error,
  } = useK8sWatchResource<SecretKind>(
    {
      groupVersionKind: SecretGroupVersionKind,
      namespace,
      name,
      partialMetadata: true,
      watch: false,
    },
    SecretModel,
    {
      enabled: !!namespace && !!name,
    },
    secretGetPartialMetadataFetchOptions,
  );
  return [secret, !isLoading, error];
};
