/**
 * Client-safe copies of the rules enforced in src/lib/auth.ts, used for inline
 * validation (SRS USE-2). The server remains the source of truth, so keep these in sync.
 */
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

export function getEmailError(value: string) {
  if (!value.trim()) {
    return "Email is required.";
  }

  return isValidEmail(value) ? null : "Enter a valid email address, like name@company.com.";
}

export type PasswordRule = {
  label: string;
  met: boolean;
};

export function getPasswordRules(password: string): PasswordRule[] {
  return [
    { label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: password.length >= MIN_PASSWORD_LENGTH },
    { label: "At least one letter", met: /[A-Za-z]/.test(password) },
    { label: "At least one number", met: /\d/.test(password) },
  ];
}

export function isPasswordValid(password: string) {
  return getPasswordRules(password).every((rule) => rule.met);
}
