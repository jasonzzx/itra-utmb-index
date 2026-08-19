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
```

## Gotchas worth knowing before changing things

- **ITRA is behind AWS WAF Bot Control** and challenges datacenter IPs. In this
  sandbox, outbound requests must go through the proxy — `src/lib/http.ts` reads
  `OUTBOUND_PROXY_URL` / `HTTPS_PROXY` and applies an undici `ProxyAgent`. A
  `202` with `x-amzn-waf-action: challenge` means the challenge fired; that is
  an access control, so report it, don't try to defeat it.
- **ITRA's CSRF token expires within minutes.** `src/lib/itra.ts` holds a
  session briefly and retries once on 400/403 with a fresh token. Caching means
  this path runs rarely, so it is covered by unit tests rather than found in
  production.
- **ITRA's per-runner endpoints return 401.** Search-by-name is the only public
  path; runners are pinned by `itraRunnerId` / `utmbId` and matched on ID.
- **A UTMB `ip` of `0` means "no index in that category"**, not a zero score.
  Render it as `—` and omit it from breakdowns.
- **`cacheComponents` is enabled** (Next 16). It rejects the `runtime` route
  segment config, and any uncached data read in a prerendered route must be
  wrapped in `'use cache'` or the build fails.
- **Sources fail independently.** If ITRA is down, UTMB values must still
  render. Never let one source's failure blank a card.
