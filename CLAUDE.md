# Project rules

## Git

1. **Never add Claude as a co-author.** No `Co-Authored-By: Claude ...` trailer,
   no `Claude-Session:` trailer, no Claude/Anthropic attribution anywhere in a
   commit message. Commits are authored by **Jason Zhong
   <jasonzzx@gmail.com>** — check `git log -1 --pretty='%an <%ae>'` before
   pushing, because the sandbox's global git identity defaults to `Claude` and
   will silently author commits as Claude unless overridden.

2. **Commit and push directly to `main`.** No feature branches, no pull
   requests unless explicitly asked. Work on `main`, commit there, `git push`
   there.

## Commands

```bash
npm run dev          # http://localhost:3000
npm test             # unit tests, no network
LIVE=1 npm test      # also runs live smoke tests against ITRA and UTMB
npm run typecheck
npm run build
npm run doctor    # is ITRA reachable from this machine?
```

## Gotchas worth knowing before changing things

- **ITRA is behind AWS WAF Bot Control** and refuses datacenter IPs two
  different ways: a **challenge** is `202` with `x-amzn-waf-action: challenge`,
  a **block** is a bare `403`. Both are access controls — report them, don't
  try to defeat them. `src/lib/http.ts` reads `OUTBOUND_PROXY_URL` /
  `HTTPS_PROXY` and applies an undici `ProxyAgent`; in this sandbox outbound
  requests must go through it. `npm run doctor` reports which case you are in
  from wherever it is run.
- **Keep ITRA request volume low** — being refused is the failure mode that
  actually bites. Requests are capped at two in flight, concurrent callers
  share one CSRF handshake, a refusal starts a 60s cooldown, and a 403 is never
  retried.
- **ITRA's bot protection does not refuse the whole site at once.** A network
  can be served `/api/runner/find` and still be challenged on `/RunnerSpace/`,
  which looks like "most runners work, this one doesn't" — the ones that fail
  are the ones search can't reach, so they are the only ones that fetch a page.
  The cooldown is therefore kept per path.
- **Every ITRA request in a lookup should carry the same session.** The runner
  page fetch reuses the cookies the search handshake already holds (never
  acquires its own — that would add a request and a new failure mode).
- **ITRA's CSRF token expires within minutes.** `src/lib/itra.ts` holds a
  session briefly and retries once on 400/403 with a fresh token. Caching means
  this path runs rarely, so it is covered by unit tests rather than found in
  production.
- **ITRA's per-runner *API* endpoints return 401, but the runner page is
  public.** `itra.run/RunnerSpace/-/<id>` redirects to the profile, whose HTML
  embeds the index in a `var Model = {…}` blob — `fetchItraProfile` reads it,
  and that is the only exact ITRA lookup there is. It has no race history, so
  `fetchItraIndex` still searches first and falls back to the page.
- **`RunnerRef.itraUri` saves that redirect** by addressing the canonical slug
  (`chen.yu.7479205`) directly. Unlike `utmbUri` it is optional — the id gets
  there either way — but it halves the requests on the path most likely to be
  refused.
- **UTMB's runner page is the only exact UTMB lookup, and the slug addresses
  it.** `utmb.world/runner/<uri>` 404s on the id alone, so `RunnerRef.utmbUri`
  holds the whole `7388490.yu.chen`. Its `__NEXT_DATA__` carries the name,
  nationality code and all five category indexes at once.
- **A pinned UTMB id alone does not guarantee a result.** Search ranks by
  index, and the id is only matched *within* the rows it returns — "Yu Chen" is
  684 people, and the one at 382 is nowhere near them. `fetchUtmbIndex` searches
  first (small payload, finds most people) and falls back to the page.
- **Anything a lookup is made from belongs in `useRunnerIndexes`'s key.** It is
  what sends an edited runner back to the server; a pin changed outside it lands
  in storage and the card goes on showing the old answer.
- **`RunnerRef.alias` is display only.** Lookups always use `name`; an alias
  would find nobody upstream.
- **Re-pinning UTMB has to carry the name with it.** `fetchUtmbIndex` searches
  `name` and matches on id, so a new `utmbId` beside a stale name resolves to
  nothing. `RunnerEditor` takes the name from the link's slug for that reason.
- **A UTMB `ip` of `0` means "no index in that category"**, not a zero score.
  Render it as `—` and omit it from breakdowns.
- **`cacheComponents` is enabled** (Next 16). It rejects the `runtime` route
  segment config, and any uncached data read in a prerendered route must be
  wrapped in `'use cache'` or the build fails.
- **Sources fail independently.** If ITRA is down, UTMB values must still
  render. Never let one source's failure blank a card.
