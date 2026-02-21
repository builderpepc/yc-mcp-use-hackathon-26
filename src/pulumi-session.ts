export interface PulumiSession {
  accessToken: string;
  org: string;
  configuredAt: string;
}

// One active session per server instance.
// For a multi-tenant production system this would be keyed by user identity,
// but for a single-operator or demo deployment this is sufficient.
let activeSession: PulumiSession | null = null;

export function setPulumiSession(accessToken: string, org: string): void {
  activeSession = { accessToken, org, configuredAt: new Date().toISOString() };
}

export function getPulumiSession(): PulumiSession | null {
  return activeSession;
}

export function clearPulumiSession(): void {
  activeSession = null;
}
