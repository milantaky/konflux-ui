import React from 'react';
import { Button } from '@patternfly/react-core';
import { EyeIcon } from '@patternfly/react-icons/dist/esm/icons/eye-icon';
import { useField } from 'formik';
import { InputField } from 'formik-pf';
import DropdownField from '~/shared/components/formik-fields/DropdownField';
import { SourceSecretType } from '~/types/secret';
import EncodedFileUploadField from './EncodedFileUploadField';
import { useSecretEditRevealOptional } from './secretEditRevealContext';
import { SecretPasswordFormField } from './SecretPasswordFormField';

type SourceSecretFormProps = {
  onAuthTypeChange?: (type: SourceSecretType) => void;
  isEditMode?: boolean;
};

export const SourceSecretForm: React.FC<SourceSecretFormProps> = ({
  onAuthTypeChange,
  isEditMode = false,
}) => {
  const [{ value: type }] = useField<SourceSecretType>('source.authType');
  const revealCtx = useSecretEditRevealOptional();

  React.useEffect(() => {
    onAuthTypeChange?.(type);
  }, [type, onAuthTypeChange]);

  return (
    <>
      <DropdownField
        name="source.authType"
        label="Authentication type"
        helpText={
          isEditMode
            ? 'You cannot edit the authentication type in edit mode'
            : 'Select how you want to authenticate'
        }
        items={[
          { key: 'basic', value: SourceSecretType.basic },
          { key: 'ssh', value: SourceSecretType.ssh },
        ]}
        isDisabled={isEditMode}
        required={!isEditMode}
        className="secret-type-subform__dropdown"
      />
      <InputField name="source.host" label="Host" helperText="Host for the secret" />
      <InputField name="source.repo" label="Repository" helperText="Repository for the secret" />
      {type === SourceSecretType.basic ? (
        <>
          <InputField
            name="source.username"
            data-test="secret-source-username"
            label="Username"
            helperText="For Git authentication"
          />
          <SecretPasswordFormField
            name="source.password"
            data-test="secret-source-password"
            label="Password"
            helperText="For Git authentication"
            placeholder={isEditMode ? 'To keep the same password, leave this field blank' : ''}
            isRequired={!isEditMode}
          />
        </>
      ) : (
        <>
          {isEditMode && revealCtx && !revealCtx.hasFullSecret ? (
            <div className="pf-v5-u-mb-md">
              <Button
                type="button"
                variant="secondary"
                icon={<EyeIcon />}
                onClick={() => void revealCtx.ensureFullSecretLoaded()}
              >
                Reveal SSH private key to edit
              </Button>
            </div>
          ) : null}
          <EncodedFileUploadField
            name="source.ssh-privatekey"
            id="text-file-ssh"
            label="SSH private key"
            helpText={
              isEditMode
                ? 'If you want to keep the same SSH private key, leave this field blank'
                : 'For Git authentication'
            }
            required={!isEditMode}
          />
        </>
      )}
    </>
  );
};
export { SourceSecretType };
