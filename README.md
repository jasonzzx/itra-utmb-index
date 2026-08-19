# Trail Index

A mobile web app for tracking the **ITRA Performance Index** and **UTMB Index**
of the trail runners you follow. Runners you add live in your browser's local
storage; curated lists are committed to this repo and served at their own route
so they can be shared with a link.

<!-- Built with Next.js 16 (App Router) and deployed on Vercel. -->

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

| Route | What it is |
| --- | --- |
| `/` | **My Runners** — your personal list, stored in local storage |
| `/search` | Add a runner; searches ITRA and UTMB together |
| `/crit` | The roster committed at `lists/crit.json` |
| `/<slug>` | Any other `lists/<slug>.json` |

## Sharing a list

Drop a JSON file in [`lists/`](lists/README.md) and it becomes a route — no code
changes. `lists/crit.json` is served at `/crit`.

When someone opens your list they see exactly what's committed. The moment they
add or remove a runner, the app **forks the list into their own local storage**
and uses that copy instead. Your published file is never modified, and a
"Reset to original" button discards their copy. So a friend can start from your
list, make it theirs, and you keep yours.

## How the data is fetched

Neither source has a public API, so both are proxied through this app's route
handlers. A browser cannot call either directly.

**UTMB** — `api.utmb.world/search/runners` returns clean JSON with no auth, but
sends no `Access-Control-Allow-Origin` header, so the request must be
server-side. The `ip` field is the UTMB Index, and it varies by `category`
(`general`, `20k`, `50k`, `100k`, `100m`). An `ip` of `0` means the runner has
no index in that category and is displayed as `—`, not as a zero score.

**ITRA** — `itra.run/api/runner/find` is a POST that needs a browser
`User-Agent` (it 403s otherwise), `Origin`/`Referer` headers, and an
`X-CSRF-TOKEN` scraped from the hidden `__RequestVerificationToken` input on the
search page. The response body is AES-256-CBC encrypted, with the ciphertext,
IV, and key all shipped together as `response1`/`response2`/`response3` — the
official site decrypts it in WebCrypto and so do we.

Two consequences worth knowing:

- **The CSRF token expires within minutes.** One token is reused across a batch
  of lookups (5 parallel searches complete in ~0.6s), and a 400/403 triggers one
  retry with a fresh token. This is covered by a unit test, because caching
  means the handshake runs rarely and a silent break would be easy to miss.
- **ITRA's per-runner endpoints require auth** and return 401, so search-by-name
  is the only public path. Saved runners store the resolved `itraRunnerId` and
  `utmbId`, and refreshes re-search the name but match strictly on ID — two
  runners with the same name can never be confused.

### ⚠️ ITRA and datacenter IPs

ITRA sits behind **AWS WAF Bot Control**, which challenges requests from
datacenter IP ranges — Vercel's serverless egress included. When challenged,
ITRA answers `202` with `x-amzn-waf-action: challenge` and a JavaScript
challenge page.

That is an access control, so this app **detects and reports it rather than
trying to defeat it**. Set `OUTBOUND_PROXY_URL` (see `.env.example`) to route
requests through a proxy with a non-datacenter exit IP.

If ITRA is unavailable for any reason, **UTMB numbers still load** — the two
sources are resolved independently and one failing never blanks the other.

## Caching

Indexes only move when race results are scored, so they're cached server-side
with Next 16's `use cache`, keyed **per runner per source** (not per list, so
two lists sharing a runner share one entry). 12h revalidate, 7d ceiling.

The cache is bypassed in exactly two cases:

- **The refresh button**, which sends `force: true`. The route then calls the
  *uncached* function directly and separately invalidates the tag — reading back
  through the cache in the same request after `revalidateTag` is not reliable,
  so the direct call is what makes the button actually refresh.
- **A newly added runner**, which is a cache miss by definition.

The client also keeps a snapshot of the last-known values in local storage, so a
list paints instantly on open and then reconciles against the server. A snapshot
value is only overwritten by a success, so a transient outage can't wipe a good
number off the screen.

## Testing

```bash
npm test             # unit tests, no network
LIVE=1 npm test      # also runs the live smoke tests against ITRA and UTMB
npm run typecheck
npm run build
```

The live tests are opt-in so CI doesn't depend on two third-party sites. The
offline tests cover the AES decrypt against a recorded fixture, the
stale-token retry, ID pinning, `ip: 0` handling, and schema validation of every
committed list — a malformed shared list fails CI rather than the page.

## A note on the sources

Both endpoints are undocumented and unofficial; this is a personal-scale tool
that reads public profile data the same way the sites' own pages do. They can
change without warning. Each source is isolated in a single file
(`src/lib/itra.ts`, `src/lib/utmb.ts`), so a fix is one file. Be considerate
with request volume — caching is on by default for that reason.

Not affiliated with ITRA or UTMB.
