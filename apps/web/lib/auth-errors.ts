type AuthError = {
  message?: string;
  code?: string;
  status?: number;
  statusText?: string;
};

const SIGN_IN_ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "The email or password you entered is incorrect. Please check your credentials and try again.",
  INVALID_EMAIL: "No account found with this email address. Please check the email or create a new account.",
  INVALID_PASSWORD: "The password you entered is incorrect. Please try again or reset your password.",
  EMAIL_NOT_VERIFIED: "Your email address has not been verified yet. Please check your inbox for a verification link.",
  USER_NOT_FOUND: "No account found with this email address. Please check the email or create a new account.",
  USER_BANNED: "This account has been suspended. Please contact the school administration for assistance.",
  TOO_MANY_REQUESTS: "Too many attempts. Please wait a few minutes and try again.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "No account found with this email address. You may need to sign up first.",
};

const SIGN_UP_ERRORS: Record<string, string> = {
  USER_ALREADY_EXISTS: "An account with this email already exists. Please sign in instead.",
  INVALID_EMAIL: "Please enter a valid email address.",
  WEAK_PASSWORD: "Your password is too weak. Please use at least 8 characters with a mix of uppercase letters and numbers.",
  TOO_MANY_REQUESTS: "Too many attempts. Please wait a few minutes and try again.",
};

function matchMessage(msg: string, errors: Record<string, string>): string | null {
  const lower = msg.toLowerCase();

  if (lower.includes("already exist"))
    return errors.USER_ALREADY_EXISTS ?? SIGN_UP_ERRORS.USER_ALREADY_EXISTS;
  if (lower.includes("invalid") && (lower.includes("email") || lower.includes("password")))
    return errors.INVALID_EMAIL_OR_PASSWORD ?? errors.INVALID_EMAIL ?? null;
  if (lower.includes("not verified") || lower.includes("email_not_verified"))
    return errors.EMAIL_NOT_VERIFIED ?? SIGN_IN_ERRORS.EMAIL_NOT_VERIFIED;
  if (lower.includes("not found") || lower.includes("credential"))
    return errors.CREDENTIAL_ACCOUNT_NOT_FOUND ?? errors.USER_NOT_FOUND ?? null;
  if (lower.includes("banned") || lower.includes("disabled") || lower.includes("suspended"))
    return errors.USER_BANNED ?? SIGN_IN_ERRORS.USER_BANNED;
  if (lower.includes("too many") || lower.includes("rate"))
    return errors.TOO_MANY_REQUESTS ?? SIGN_IN_ERRORS.TOO_MANY_REQUESTS;
  if (lower.includes("uppercase") || lower.includes("number") || lower.includes("complexity") || lower.includes("min 8"))
    return "Password must be at least 8 characters with at least one uppercase letter and one number.";

  return null;
}

function resolveError(error: AuthError, map: Record<string, string>, fallbackAction: string): string {
  if (error.code && map[error.code]) {
    return map[error.code];
  }

  if (error.message) {
    const matched = matchMessage(error.message, map);
    if (matched) return matched;
  }

  if (error.status === 401) return map.INVALID_EMAIL_OR_PASSWORD ?? `${fallbackAction} failed. Please check your credentials.`;
  if (error.status === 403) return map.EMAIL_NOT_VERIFIED ?? SIGN_IN_ERRORS.EMAIL_NOT_VERIFIED;
  if (error.status === 429) return map.TOO_MANY_REQUESTS ?? SIGN_IN_ERRORS.TOO_MANY_REQUESTS;

  return error.message || `${fallbackAction} failed (${error.statusText || `status ${error.status}`}). Please try again.`;
}

export function getSignInError(error: AuthError): string {
  return resolveError(error, SIGN_IN_ERRORS, "Sign-in");
}

export function getSignUpError(error: AuthError): string {
  return resolveError(error, SIGN_UP_ERRORS, "Sign-up");
}

export function getNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("Failed to fetch")) {
    return "Unable to reach the server. Please check your internet connection or try again later.";
  }
  return msg || "An unexpected error occurred. Please try again.";
}
