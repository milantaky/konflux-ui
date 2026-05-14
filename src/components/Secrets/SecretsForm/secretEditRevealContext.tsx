import * as React from 'react';

export type SecretEditRevealContextValue = {
  ensureFullSecretLoaded: () => Promise<void>;
  /** Clears cached full secret and the given Formik field (password value). */
  onSensitiveFieldBlur: (fieldName: string) => void;
  hasFullSecret: boolean;
};

const SecretEditRevealContext = React.createContext<SecretEditRevealContextValue | null>(null);

export const SecretEditRevealProvider = SecretEditRevealContext.Provider;

export const useSecretEditRevealOptional = (): SecretEditRevealContextValue | null =>
  React.useContext(SecretEditRevealContext);

export const useSecretEditReveal = (): SecretEditRevealContextValue => {
  const ctx = useSecretEditRevealOptional();
  if (!ctx) {
    throw new Error('useSecretEditReveal must be used within SecretEditRevealProvider');
  }
  return ctx;
};
