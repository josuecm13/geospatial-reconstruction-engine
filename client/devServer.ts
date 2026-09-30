/**
 * Where the dev server listens and where it forwards API calls, from the environment.
 *
 * The API's port is `APP_PORT` from `server/.env` (the same file uvicorn is started with), so
 * nothing here hardcodes it. The client's own port is `CLIENT_PORT`. Both have defaults far
 * from the usual dev ports, matching the project's convention.
 */
export const DEFAULT_APP_PORT = 58000;
export const DEFAULT_CLIENT_PORT = 55173;
/** Browser code calls the API under this prefix; the dev server strips it and forwards. */
export const API_PREFIX = "/api";

export interface DevServerConfig {
  clientPort: number;
  apiTarget: string;
}

function port(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a port number, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function resolveDevServerConfig(env: Record<string, string | undefined>): DevServerConfig {
  const apiTarget = env.API_TARGET?.trim() || `http://localhost:${port(env.APP_PORT, DEFAULT_APP_PORT, "APP_PORT")}`;
  return { clientPort: port(env.CLIENT_PORT, DEFAULT_CLIENT_PORT, "CLIENT_PORT"), apiTarget };
}

/** `/api/import-areas` → `/import-areas`: the API itself serves from the root. */
export function stripApiPrefix(path: string): string {
  return path.startsWith(API_PREFIX + "/") || path === API_PREFIX ? path.slice(API_PREFIX.length) || "/" : path;
}
