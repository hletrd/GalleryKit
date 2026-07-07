#!/usr/bin/env node

const HELP = `
Usage:
  npm run check:proxy-topology -- --url https://gallery.example.com [--direct-url http://127.0.0.1:3000]

Read-only public-edge check for the deployed proxy topology. The check sends
valid JSON POST probes to the public semantic-search route so the request
reaches same-origin and client-IP/rate-limit handling before failing on normal
disabled-mode or invalid-query validation.

This status-code probe proves that spoofed forwarded host/proto headers do not
change same-origin evaluation. It cannot prove that the edge overwrote inbound
X-Forwarded-For or that the app selected the intended client-IP rate-limit
bucket; verify real-IP behavior separately with edge logs or a diagnostic that
observes the effective client key.
`;

function parseArgs(argv) {
  const args = { url: process.env.PROXY_TOPOLOGY_URL, directUrl: process.env.PROXY_TOPOLOGY_DIRECT_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--url') args.url = argv[++i];
    else if (arg === '--direct-url') args.directUrl = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function toUrl(value, label) {
  if (!value) throw new Error(`Missing ${label}. Pass --url or set PROXY_TOPOLOGY_URL.`);
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label} must be an http(s) URL.`);
  }
  return url;
}

async function request(url, init) {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text().catch(() => ''),
  };
}

function semanticProbeUrl(edgeUrl) {
  return new URL('/api/search/semantic', edgeUrl);
}

function classifyBaseline(status) {
  if (status === 403) {
    throw new Error('Baseline same-origin probe returned 403; verify --url matches the public origin served by the app.');
  }
  if ([400, 404, 405, 415, 429, 503].includes(status)) return;
  if (status >= 500) {
    throw new Error(`Baseline same-origin probe returned ${status}; app or edge is unhealthy.`);
  }
  throw new Error(`Baseline same-origin probe returned unexpected HTTP ${status}; expected a validation/config/rate-limit failure.`);
}

function classifySpoof(status) {
  if (status === 403) {
    throw new Error(
      'Spoofed forwarded headers changed same-origin evaluation. The edge must overwrite X-Forwarded-Host and X-Forwarded-Proto before the app.',
    );
  }
  if ([400, 404, 405, 415, 429, 503].includes(status)) return;
  if (status >= 500) throw new Error(`Spoofed-header probe returned ${status}; app or edge is unhealthy.`);
  throw new Error(`Spoofed-header probe returned unexpected HTTP ${status}; expected a validation/config/rate-limit failure.`);
}

async function checkDirectExposure(directUrl) {
  if (!directUrl) return;
  const url = toUrl(directUrl, '--direct-url');
  let response;
  try {
    response = await request(url, { method: 'GET', headers: { Host: 'direct-probe.invalid' } });
  } catch {
    return;
  }
  if (response.status > 0 && response.status < 500) {
    throw new Error(
      `Direct app URL responded with HTTP ${response.status}. Do not expose the app port directly when TRUST_PROXY=true; keep it behind the trusted edge.`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const edgeUrl = toUrl(args.url, '--url');
  const probeUrl = semanticProbeUrl(edgeUrl);
  const origin = edgeUrl.origin;

  const baseline = await request(probeUrl, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '', topK: 1 }),
  });
  classifyBaseline(baseline.status);

  const spoofed = await request(probeUrl, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Forwarded-Host': 'attacker.invalid',
      'X-Forwarded-Proto': edgeUrl.protocol === 'https:' ? 'http' : 'https',
      'X-Forwarded-For': '198.51.100.44, 203.0.113.99',
    },
    body: JSON.stringify({ query: '', topK: 1 }),
  });
  classifySpoof(spoofed.status);

  await checkDirectExposure(args.directUrl);

  console.log(`Proxy topology check passed for ${origin}`);
  console.log('verified=same-origin forwarded-host/proto spoof resistance');
  console.log('not-verified=effective client-IP bucket or X-Forwarded-For overwrite');
  console.log(`baseline=${baseline.status} spoofed-forwarded-headers=${spoofed.status}`);
}

main().catch((error) => {
  console.error(`[check-proxy-topology] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
