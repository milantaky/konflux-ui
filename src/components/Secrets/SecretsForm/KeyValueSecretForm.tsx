import React from 'react';
import { Button, HelperText, HelperTextItem, Title, TitleSizes } from '@patternfly/react-core';
import { EyeIcon } from '@patternfly/react-icons/dist/esm/icons/eye-icon';
import EncodedKeyValueFileInputField from './EncodedKeyValueUploadField';
import { useSecretEditRevealOptional } from './secretEditRevealContext';

type KeyValueSecretFormProps = {
  isEditMode?: boolean;
};

export const KeyValueSecretForm: React.FC<React.PropsWithChildren<KeyValueSecretFormProps>> = ({
  isEditMode = false,
}) => {
  const revealCtx = useSecretEditRevealOptional();

  return (
    <>
      <Title size={TitleSizes.md} headingLevel="h4">
        Key/value secret
        <HelperText style={{ fontWeight: 100 }}>
          <HelperTextItem variant="indeterminate">
            Key/value secrets let you inject sensitive data into your application as files or
            environment variables
          </HelperTextItem>
        </HelperText>
      </Title>
      {isEditMode && revealCtx && !revealCtx.hasFullSecret ? (
        <div className="pf-v5-u-mb-md">
          <Button
            type="button"
            variant="secondary"
            icon={<EyeIcon />}
            onClick={() => void revealCtx.ensureFullSecretLoaded()}
          >
            Reveal key/value data to edit
          </Button>
        </div>
      ) : null}
      <EncodedKeyValueFileInputField name="opaque.keyValues" data-test="secret-key-value-pair" />
    </>
  );
};
