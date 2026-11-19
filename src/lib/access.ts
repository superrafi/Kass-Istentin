export interface AccessConfig {
  /** Workspace domain that may sign in. Without it nobody gets in. */
  allowedDomain: string | undefined;
  /** If non-empty, only these addresses may sign in. */
  allowedEmails: string[];
}

export interface GoogleIdentity {
  email?: string | null;
  email_verified?: boolean | null;
  /** Hosted domain claim, only set for Google Workspace accounts. */
  hd?: string | null;
}

export function readAccessConfig(
  env: Record<string, string | undefined>,
): AccessConfig {
  return {
    allowedDomain: env.ALLOWED_GOOGLE_DOMAIN?.trim().toLowerCase() || undefined,
    allowedEmails: (env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  };
}

/**
 * Decides whether a Google account may use the app. Fails closed: a missing
 * domain setting or an incomplete identity denies access.
 */
export function isAllowedUser(
  identity: GoogleIdentity | null | undefined,
  config: AccessConfig,
): boolean {
  if (!config.allowedDomain) return false;
  if (!identity?.email || identity.email_verified !== true) return false;

  const email = identity.email.toLowerCase();
  // The hd claim is what Google vouches for; the address suffix alone is not enough.
  if (identity.hd?.toLowerCase() !== config.allowedDomain) return false;
  if (!email.endsWith(`@${config.allowedDomain}`)) return false;

  return config.allowedEmails.length === 0 || config.allowedEmails.includes(email);
}
