import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Bullseye,
  Form,
  PageSection,
  PageSectionVariants,
  Spinner,
} from '@patternfly/react-core';
import { Formik, FormikProps } from 'formik';
import { isEmpty } from 'lodash-es';
import PageLayout from '~/components/PageLayout/PageLayout';
import { LEARN_MORE_ABOUT_SECRETS_CREATION } from '~/consts/documentation';
import { FeatureFlagIndicator } from '~/feature-flags/FeatureFlagIndicator';
import { useSearchParam } from '~/hooks/useSearchParam';
import { getSecretFullQueryKey, useSecret } from '~/hooks/useSecrets';
import { K8sGetResource } from '~/k8s';
import { queryClient } from '~/k8s/query/core';
import { SecretModel } from '~/models';
import { logger } from '~/monitoring/logger';
import { SECRET_LIST_PATH } from '~/routes/paths';
import FormFooter from '~/shared/components/form-components/FormFooter';
import ExternalLink from '~/shared/components/links/ExternalLink';
import { useNamespace } from '~/shared/providers/Namespace';
import { getErrorState } from '~/shared/utils/error-utils';
import {
  AddSecretFormValues,
  KeyValueEntry,
  SecretFor,
  SecretKind,
  SecretLabels,
  SecretType,
  SecretTypeDropdownLabel,
} from '~/types';
import {
  editSecretResource,
  getAuthType,
  getRegistryCreds,
  getSecretBreadcrumbs,
  inferSecretK8sTypeFromMetadata,
  inferSecretTypeDropdown,
} from '~/utils/secrets/secret-utils';
import { secretFormValidationSchema } from '../utils/secret-validation';
import { SecretEditRevealContextValue, SecretEditRevealProvider } from './secretEditRevealContext';
import { SecretTypeSubForm } from './SecretTypeSubForm';

const GLOBAL_CONTEXT_EVENT = 'konflux:global-context-change';

const isUnset = (value: unknown): boolean => value === '' || value === undefined;

function effectiveK8sSecretType(secret: SecretKind, dropdown: SecretTypeDropdownLabel): SecretType {
  const inferred = inferSecretK8sTypeFromMetadata(secret);
  if (inferred) {
    return inferred as SecretType;
  }
  if (secret.type) {
    return secret.type as SecretType;
  }
  if (dropdown === SecretTypeDropdownLabel.image) {
    return SecretType.dockerconfigjson;
  }
  if (dropdown === SecretTypeDropdownLabel.source) {
    return SecretType.basicAuth;
  }
  return SecretType.opaque;
}

function buildEditSecretInitialValues(secretData: SecretKind): AddSecretFormValues {
  const inferredDropdown = inferSecretTypeDropdown(secretData);
  if (!inferredDropdown) {
    throw new Error('Unable to infer secret type');
  }
  const typeFromLabels = effectiveK8sSecretType(secretData, inferredDropdown);
  const secretType = inferredDropdown;
  const authTypeFromLabels = getAuthType(typeFromLabels);

  const readLabels = secretData.metadata?.labels
    ? Object.entries(secretData.metadata.labels).map(([key, value]) => ({ key, value }))
    : [];

  const opaqueSecret = Object.entries(secretData.data ?? {}).map(([key, value]) => ({
    key,
    value,
  }));

  const secretForRegistry =
    secretType === SecretTypeDropdownLabel.image
      ? ({ ...secretData, type: SecretType.dockerconfigjson } as SecretKind)
      : secretData;

  const registryCreds = getRegistryCreds(secretForRegistry);

  const imageSecret =
    secretType === SecretTypeDropdownLabel.image
      ? {
          authType: authTypeFromLabels,
          registryCreds: registryCreds.map((cred) => ({ ...cred, password: '' })),
          dockerconfig: secretData.data?.['.dockercfg'],
        }
      : undefined;

  const sourceSecret =
    secretType === SecretTypeDropdownLabel.source
      ? {
          authType: authTypeFromLabels,
          username:
            typeFromLabels === SecretType.basicAuth && secretData.data?.username
              ? atob(secretData.data.username)
              : '',
          password: '',
          host: secretData.metadata?.labels?.[SecretLabels.HOST_LABEL] || '',
          repo: secretData.metadata?.annotations?.[SecretLabels.REPO_ANNOTATION] || '',
          ...(typeFromLabels === SecretType.sshAuth && { 'ssh-privatekey': '' }),
        }
      : undefined;

  return {
    type: secretType,
    name: secretData.metadata.name,
    secretFor: SecretFor.Build,
    opaque: {
      keyValues: opaqueSecret.length ? opaqueSecret : [{ key: '', value: '' }],
    },
    image: imageSecret,
    source: { ...sourceSecret },
    labels: [...readLabels] as KeyValueEntry[],
  };
}

function preserveUnsetSensitiveSecretValues(
  values: AddSecretFormValues,
  secretData: SecretKind,
  secretType: SecretTypeDropdownLabel,
  typeFromLabels: SecretType,
  parsedRegistryCreds: ReturnType<typeof getRegistryCreds>,
): void {
  switch (typeFromLabels) {
    case SecretType.sshAuth:
      if (isUnset(values.source['ssh-privatekey']) && secretData.data?.['ssh-privatekey']) {
        values.source['ssh-privatekey'] = secretData.data['ssh-privatekey'];
      }
      break;
    case SecretType.basicAuth:
      if (
        secretType === SecretTypeDropdownLabel.source &&
        isUnset(values.source.password) &&
        secretData.data?.password
      ) {
        values.source.password = atob(secretData.data.password);
      }
      break;
    case SecretType.dockerconfigjson:
      if (secretType === SecretTypeDropdownLabel.image) {
        values.image.registryCreds.forEach((cred, idx) => {
          cred.password = cred.password === '' ? parsedRegistryCreds[idx]?.password : cred.password;
        });
      }
      break;
    default:
      break;
  }
}

function needsBackendSecretDataForPreserve(
  values: AddSecretFormValues,
  secretType: SecretTypeDropdownLabel,
  typeFromLabels: SecretType,
): boolean {
  switch (typeFromLabels) {
    case SecretType.sshAuth:
      return isUnset(values.source['ssh-privatekey']);
    case SecretType.basicAuth:
      return secretType === SecretTypeDropdownLabel.source && isUnset(values.source.password ?? '');
    case SecretType.dockerconfigjson:
      return (
        secretType === SecretTypeDropdownLabel.image &&
        values.image.registryCreds.some((c) => c.password === '')
      );
    default:
      return false;
  }
}

type EditSecretFormInnerProps = {
  namespace: string;
  secretName: string;
  resolvedFullSecret: SecretKind | null;
  setResolvedFullSecret: React.Dispatch<React.SetStateAction<SecretKind | null>>;
  formikBag: FormikProps<AddSecretFormValues>;
};

const EditSecretFormInner: React.FC<EditSecretFormInnerProps> = ({
  namespace,
  secretName,
  resolvedFullSecret,
  setResolvedFullSecret,
  formikBag,
}) => {
  const { status, isSubmitting, handleReset, dirty, errors, handleSubmit, setFieldValue } =
    formikBag;

  const hasFullSecret = Boolean(resolvedFullSecret?.data);

  const ensureFullSecretLoaded = React.useCallback(async () => {
    if (resolvedFullSecret?.data) {
      return;
    }
    const row = await queryClient.fetchQuery({
      queryKey: getSecretFullQueryKey(namespace, secretName),
      queryFn: () =>
        K8sGetResource<SecretKind>({
          model: SecretModel,
          queryOptions: { ns: namespace, name: secretName },
        }),
    });
    setResolvedFullSecret(row);
  }, [namespace, secretName, resolvedFullSecret, setResolvedFullSecret]);

  const onSensitiveFieldBlur = React.useCallback(
    (fieldName: string) => {
      setResolvedFullSecret(null);
      void queryClient.removeQueries({
        queryKey: getSecretFullQueryKey(namespace, secretName),
      });
      void setFieldValue(fieldName, '');
    },
    [namespace, secretName, setFieldValue, setResolvedFullSecret],
  );

  const revealContext: SecretEditRevealContextValue = React.useMemo(
    () => ({
      ensureFullSecretLoaded,
      onSensitiveFieldBlur,
      hasFullSecret,
    }),
    [ensureFullSecretLoaded, onSensitiveFieldBlur, hasFullSecret],
  );

  return (
    <SecretEditRevealProvider value={revealContext}>
      <PageLayout
        breadcrumbs={getSecretBreadcrumbs(namespace, 'Edit')}
        title={
          <>
            Edit secret
            <FeatureFlagIndicator flags={['edit-secret-page']} />
          </>
        }
        description={
          <>
            Edit a secret that is stored using AWS Secret Manager to keep your data private.{' '}
            <ExternalLink href={LEARN_MORE_ABOUT_SECRETS_CREATION}>Learn more</ExternalLink>
          </>
        }
        footer={
          <FormFooter
            submitLabel="Edit secret"
            handleSubmit={handleSubmit}
            errorMessage={status && status.submitError}
            handleCancel={handleReset}
            isSubmitting={isSubmitting}
            disableSubmit={!dirty || !isEmpty(errors) || isSubmitting}
          />
        }
      >
        <PageSection variant={PageSectionVariants.light} isFilled isWidthLimited>
          {!hasFullSecret ? (
            <Alert
              className="pf-v5-u-mb-md"
              variant="info"
              isInline
              title="Sensitive fields are hidden"
            >
              Use the eye icon on password fields (or the reveal actions for key/value and SSH
              secrets) to load secret data from the cluster. Data is removed from the UI when you
              leave those fields or after you save.
            </Alert>
          ) : null}
          <Form style={{ maxWidth: '70%' }}>
            <SecretTypeSubForm isEditMode />
          </Form>
        </PageSection>
      </PageLayout>
    </SecretEditRevealProvider>
  );
};

const EditSecretForm: React.FC = () => {
  const namespace = useNamespace();
  const navigate = useNavigate();
  const [secretName] = useSearchParam('secretName');

  const [metadataSecret, secretLoaded, error] = useSecret(namespace, secretName);
  const [resolvedFullSecret, setResolvedFullSecret] = React.useState<SecretKind | null>(null);

  const effectiveSecret = resolvedFullSecret ?? metadataSecret;

  React.useEffect(() => {
    setResolvedFullSecret(null);
    void queryClient.removeQueries({
      queryKey: getSecretFullQueryKey(namespace, secretName),
    });
  }, [namespace, secretName]);

  React.useEffect(() => {
    const onGlobal = () => {
      setResolvedFullSecret(null);
      void queryClient.removeQueries({
        queryKey: getSecretFullQueryKey(namespace, secretName),
      });
    };
    window.addEventListener(GLOBAL_CONTEXT_EVENT, onGlobal);
    return () => window.removeEventListener(GLOBAL_CONTEXT_EVENT, onGlobal);
  }, [namespace, secretName]);

  const initialValues = React.useMemo(() => {
    if (!effectiveSecret) {
      return undefined;
    }
    try {
      return buildEditSecretInitialValues(effectiveSecret);
    } catch {
      return undefined;
    }
  }, [effectiveSecret]);

  const inferredDropdown = metadataSecret ? inferSecretTypeDropdown(metadataSecret) : undefined;

  if (!secretLoaded) {
    return (
      <Bullseye>
        <Spinner />
      </Bullseye>
    );
  }

  if (error) {
    return getErrorState(error, secretLoaded, 'secret');
  }

  if (!metadataSecret || !initialValues || !inferredDropdown) {
    return (
      <PageLayout breadcrumbs={getSecretBreadcrumbs(namespace, 'Edit')} title="Edit secret">
        <PageSection>
          <Alert variant="warning" title="Unable to load secret">
            This secret could not be loaded, or its type cannot be determined from metadata alone.
          </Alert>
        </PageSection>
      </PageLayout>
    );
  }

  const typeFromLabels = effectiveK8sSecretType(effectiveSecret, inferredDropdown);
  const secretType = inferredDropdown;

  return (
    <Formik
      enableReinitialize
      initialValues={initialValues}
      onReset={() => {
        navigate(-1);
      }}
      onSubmit={async (values, actions) => {
        let mergeSecret: SecretKind = resolvedFullSecret ?? effectiveSecret;
        if (
          !mergeSecret.data &&
          needsBackendSecretDataForPreserve(values, secretType, typeFromLabels)
        ) {
          mergeSecret = await queryClient.fetchQuery({
            queryKey: getSecretFullQueryKey(namespace, secretName),
            queryFn: () =>
              K8sGetResource<SecretKind>({
                model: SecretModel,
                queryOptions: { ns: namespace, name: secretName },
              }),
          });
        }

        const mergeRegistryCreds = getRegistryCreds(
          secretType === SecretTypeDropdownLabel.image
            ? ({ ...mergeSecret, type: SecretType.dockerconfigjson } as SecretKind)
            : mergeSecret,
        );

        preserveUnsetSensitiveSecretValues(
          values,
          mergeSecret,
          secretType,
          typeFromLabels,
          mergeRegistryCreds,
        );

        editSecretResource(values, mergeSecret.metadata.namespace, mergeSecret)
          .then(() => {
            setResolvedFullSecret(null);
            void queryClient.removeQueries({
              queryKey: getSecretFullQueryKey(namespace, secretName),
            });
            navigate(SECRET_LIST_PATH.createPath({ workspaceName: namespace }));
          })
          .catch((editError) => {
            logger.warn('Error while submitting secret form:', { editError });
            actions.setSubmitting(false);
            actions.setStatus({ submitError: (editError as Error).message });
          });
      }}
      validationSchema={secretFormValidationSchema({ isEditMode: true })}
    >
      {(formikBag: FormikProps<AddSecretFormValues>) => (
        <EditSecretFormInner
          namespace={namespace}
          secretName={secretName}
          resolvedFullSecret={resolvedFullSecret}
          setResolvedFullSecret={setResolvedFullSecret}
          formikBag={formikBag}
        />
      )}
    </Formik>
  );
};
export default EditSecretForm;
