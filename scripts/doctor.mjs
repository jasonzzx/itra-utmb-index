#!/usr/bin/env node
/**
 * Is ITRA reachable from *this* machine?
 *
 * ITRA sits behind AWS WAF Bot Control, which challenges or blocks traffic it
 * dislikes — datacenter IP ranges, including serverless hosting, are the usual
 * casualty. That verdict depends entirely on the network the app runs from, so
 * it can only be answered by making a request from there.
 *
 *   npm run doctor
 *
 * Run it wherever you see ITRA failing. UTMB is checked too, so a failure can
 * be attributed to one source rather than to the network in general.
 */

const ORIGIN = 'https://itra.run';
const FIND_PAGE = `${ORIGIN}/Runners/FindARunner`;
const FIND_API = `${ORIGIN}/api/runner/find`;
const UTMB_API = 'https://api.utmb.world/search/runners';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const proxyUrl =
  process.env.OUTBOUND_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy;

let dispatcher;
if (proxyUrl) {
  try {
    const { ProxyAgent } = await import('undici');
    dispatcher = new ProxyAgent(proxyUrl);
  } catch {
    console.log('  ! undici not available; proxy will be ignored');
  }
}

const withProxy = (init = {}) => (dispatcher ? { ...init, dispatcher } : init);

function wafHeaders(res) {
  const out = {};
  for (const [k, v] of res.headers) {
    if (k.toLowerCase().startsWith('x-amzn-waf') || k.toLowerCase() === 'server') {
      out[k] = v;
    }
  }
  return out;
}

/** challenge | blocked | ok | error — the distinction the fix hinges on. */
function classify(res) {
  if (res.headers.get('x-amzn-waf-action') === 'challenge' || res.status === 202) {
    return 'challenge';
  }
  if (res.status === 403) return 'blocked';
  return res.ok ? 'ok' : 'error';
}

console.log('ITRA / UTMB connectivity check\n');

console.log('Environment');
console.log(`  node            ${process.version}`);
console.log(`  proxy           ${proxyUrl ? `${proxyUrl.replace(/\/\/.*@/, '//***@')} (in use)` : 'none — requests go out directly'}`);
console.log(`  VERCEL          ${process.env.VERCEL ? `yes (${process.env.VERCEL_REGION ?? 'region unknown'})` : 'no'}`);

try {
  const ipRes = await fetch('https://api.ipify.org?format=json', withProxy());
  const { ip } = await ipRes.json();
  console.log(`  egress IP       ${ip}`);
} catch {
  console.log('  egress IP       could not determine');
}

let verdict = 'ok';

console.log('\nITRA token page');
let token = null;
let cookie = '';
try {
  const res = await fetch(FIND_PAGE, withProxy({
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }));
  const state = classify(res);
  if (state !== 'ok') verdict = state;
  console.log(`  status          ${res.status} (${state})`);
  const waf = wafHeaders(res);
  if (Object.keys(waf).length) console.log(`  headers         ${JSON.stringify(waf)}`);

  const html = await res.text();
  token = /name="__RequestVerificationToken"[^>]*\bvalue="([^"]+)"/.exec(html)?.[1] ?? null;
  cookie = res.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';
  console.log(`  CSRF token      ${token ? `found (${token.length} chars)` : 'NOT FOUND'}`);
} catch (err) {
  verdict = 'error';
  console.log(`  failed          ${err.message}`);
}

console.log('\nITRA search');
if (!token) {
  console.log('  skipped         no CSRF token, so a search cannot be attempted');
} else {
  try {
    const res = await fetch(FIND_API, withProxy({
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': token,
        Origin: ORIGIN,
        Referer: FIND_PAGE,
        Accept: '*/*',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: new URLSearchParams({
        name: 'jornet', nationality: '', start: '0', count: '10', echoToken: '1',
      }),
    }));
    const state = classify(res);
    if (state !== 'ok') verdict = state;
    console.log(`  status          ${res.status} (${state})`);
    const waf = wafHeaders(res);
    if (Object.keys(waf).length) console.log(`  headers         ${JSON.stringify(waf)}`);
    if (res.ok) {
      const body = await res.json();
      const encrypted = ['response1', 'response2', 'response3'].every((k) => k in body);
      console.log(`  payload         ${encrypted ? 'encrypted as expected' : `unexpected shape: ${Object.keys(body)}`}`);
    }
  } catch (err) {
    verdict = 'error';
    console.log(`  failed          ${err.message}`);
  }
}

console.log('\nUTMB search');
try {
  const url = new URL(UTMB_API);
  url.searchParams.set('category', 'general');
  url.searchParams.set('limit', '5');
  url.searchParams.set('offset', '0');
  url.searchParams.set('search', 'jornet');
  const res = await fetch(url, withProxy());
  console.log(`  status          ${res.status} (${res.ok ? 'ok' : 'error'})`);
  if (res.ok) console.log(`  runners         ${(await res.json()).runners?.length ?? 0}`);
} catch (err) {
  console.log(`  failed          ${err.message}`);
}

console.log('\nVerdict');
if (verdict === 'ok') {
  console.log('  ITRA is reachable from this machine.');
  console.log('  If the app still shows ITRA errors, the problem is in the app, not the network.');
} else if (verdict === 'blocked') {
  console.log('  ITRA is BLOCKING this IP (HTTP 403).');
  console.log('  Its bot protection has refused this network — datacenter ranges such as');
  console.log('  serverless hosting are the usual cause. This is an access control, so the');
  console.log('  fix is to come from an address it accepts:');
  console.log('    set OUTBOUND_PROXY_URL to an HTTP proxy with a non-datacenter IP,');
  console.log('    or run the app from a network ITRA does not refuse.');
  console.log('  Until then UTMB figures still load and ITRA ones will not.');
} else if (verdict === 'challenge') {
  console.log('  ITRA is CHALLENGING this IP (AWS WAF JavaScript challenge).');
  console.log('  Same remedy as a block: set OUTBOUND_PROXY_URL, or run from another network.');
} else {
  console.log('  Could not reach ITRA at all — check general network connectivity first.');
}

process.exit(verdict === 'ok' ? 0 : 1);
