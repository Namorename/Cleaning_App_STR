/**
 * Where the pieces of a resumable upload may go (tus.ts). Her token goes
 * with every one of them, so only to the project's own storage over TLS —
 * its API host, or the storage host Supabase answers from, under the same
 * project reference. A stack on the developer's machine, or the Android
 * emulator's way to it, may go without TLS, and only to itself.
 *
 * Each check answers why an address is refused, in words for the log, or
 * null when it may be used.
 */

/** The machine itself, and the Android emulator's way to it. */
const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '10.0.2.2'];
/** A project's API host: its reference, then supabase.co. */
const PROJECT_HOST = /^([a-z0-9-]+)\.supabase\.co$/;
const DEFAULT_PORTS: Readonly<Record<string, string>> = { http: '80', https: '443' };

interface Origin {
  scheme: string;
  host: string;
  /** Empty for the scheme's own port. */
  port: string;
}

/** The scheme, host and port of an http(s) address; null for anything else, credentials included. */
function originOf(url: string): Origin | null {
  const address = /^(https?):\/\/([^/?#@]+)(?:[/?#]|$)/i.exec(url);
  if (address === null) {
    return null;
  }
  const scheme = address[1].toLowerCase();
  const hostAndPort = /^([^:]+)(?::(\d+))?$/.exec(address[2]);
  if (hostAndPort === null) {
    return null;
  }
  const port = hostAndPort[2] ?? '';
  return {
    scheme,
    host: hostAndPort[1].toLowerCase(),
    port: port === DEFAULT_PORTS[scheme] ? '' : port,
  };
}

function originText({ scheme, host, port }: Origin): string {
  return `${scheme}://${host}${port === '' ? '' : `:${port}`}`;
}

/** The project's own storage host, when the endpoint is a project's API host. */
function isProjectStorageHost(host: string, endpointHost: string): boolean {
  const project = PROJECT_HOST.exec(endpointHost);
  return project !== null && host === `${project[1]}.storage.supabase.co`;
}

/** Why the endpoint may not be sent her token, or null when it may. */
export function endpointProblem(endpoint: string): string | null {
  const origin = originOf(endpoint);
  if (origin === null) {
    return 'is not an http(s) address';
  }
  if (origin.scheme !== 'https' && !LOCAL_HOSTS.includes(origin.host)) {
    return `goes to ${origin.host} over ${origin.scheme}: only a local stack (${LOCAL_HOSTS.join(', ')}) may go without https`;
  }
  return null;
}

/** Why a piece of the upload to `endpoint` may not go to `url`, or null when it may. */
export function addressProblem(url: string, endpoint: string): string | null {
  const own = originOf(endpoint);
  const origin = originOf(url);
  if (own === null || origin === null) {
    return 'that is not an http(s) address';
  }
  if (origin.scheme !== own.scheme) {
    return `over ${origin.scheme}, not ${own.scheme}`;
  }
  if (origin.host !== own.host && !isProjectStorageHost(origin.host, own.host)) {
    return `on another host (${origin.host}), not ${own.host}`;
  }
  if (origin.port !== own.port) {
    return `on another port (${origin.port || 'default'}), not ${own.port || 'default'}`;
  }
  return null;
}

/** A Location as an address: absolute as given, or a path read against the endpoint's origin. */
export function locationAddress(location: string, endpoint: string): string {
  const own = originOf(endpoint);
  const isPath = location.startsWith('/') && !location.startsWith('//');
  return isPath && own !== null ? `${originText(own)}${location}` : location;
}
