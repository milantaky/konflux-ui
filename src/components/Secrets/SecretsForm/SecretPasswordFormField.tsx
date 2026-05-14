import * as React from 'react';
import {
  Button,
  FormGroup,
  FormHelperText,
  HelperTextItem,
  InputGroup,
  TextInput,
  ValidatedOptions,
} from '@patternfly/react-core';
import { EyeIcon } from '@patternfly/react-icons/dist/esm/icons/eye-icon';
import { EyeSlashIcon } from '@patternfly/react-icons/dist/esm/icons/eye-slash-icon';
import { useField } from 'formik';
import { useSecretEditRevealOptional } from './secretEditRevealContext';

export type SecretPasswordFormFieldProps = {
  name: string;
  label: string;
  helperText?: string;
  isRequired?: boolean;
  placeholder?: string;
  'data-test'?: string;
};

/**
 * Password field with PatternFly-style visibility toggle. On first show, loads full Secret when
 * wrapped in `SecretEditRevealProvider` (edit flow).
 */
export const SecretPasswordFormField: React.FC<SecretPasswordFormFieldProps> = ({
  name,
  label,
  helperText,
  isRequired,
  placeholder,
  'data-test': dataTest,
}) => {
  const revealCtx = useSecretEditRevealOptional();
  const [field, meta, helpers] = useField<string>(name);
  const [visible, setVisible] = React.useState(false);
  const revealRequestedRef = React.useRef(false);

  const toggleVisibility = async () => {
    if (!visible && revealCtx && !revealRequestedRef.current) {
      revealRequestedRef.current = true;
      await revealCtx.ensureFullSecretLoaded();
    }
    setVisible((v) => !v);
  };

  return (
    <FormGroup label={label} fieldId={name} isRequired={isRequired}>
      <InputGroup>
        <TextInput
          id={name}
          data-test={dataTest}
          type={visible ? 'text' : 'password'}
          value={field.value}
          validated={meta.touched && meta.error ? ValidatedOptions.error : ValidatedOptions.default}
          onChange={(_e, v) => helpers.setValue(v)}
          onBlur={(e) => {
            field.onBlur(e);
            if (revealCtx) {
              revealCtx.onSensitiveFieldBlur(name);
              setVisible(false);
              revealRequestedRef.current = false;
            }
          }}
          aria-label={label}
          placeholder={placeholder}
        />
        <Button
          type="button"
          variant="control"
          onClick={() => void toggleVisibility()}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeSlashIcon /> : <EyeIcon />}
        </Button>
      </InputGroup>
      {helperText ? <FormHelperText>{helperText}</FormHelperText> : null}
      {meta.touched && meta.error ? (
        <FormHelperText>
          <HelperTextItem variant="error">{meta.error}</HelperTextItem>
        </FormHelperText>
      ) : null}
    </FormGroup>
  );
};
