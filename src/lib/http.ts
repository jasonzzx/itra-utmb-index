import { ProxyAgent, type Dispatcher } from 'undici';

/**
 * ITRA sits behind AWS WAF Bot Control, which challenges requests from
 * datacenter IP ranges — including serverless egress. Routing outbound
 * requests through a proxy with a clean IP is the supported escape hatch.
 *
 * Set OUTBOUND_PROXY_URL (or the conventional HTTPS_PROXY) to enable it.
 * With neither set, requests go out directly, which is fine anywhere the
 * upstream isn't challenging us.
 */
let dispatcher: Dispatcher | undefined;
let resolved = false;

export function outboundDispatcher(): Dispatcher | undefined {
  if (!resolved) {
    resolved = true;
    const url =
      process.env.OUTBOUND_PROXY_URL ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy;
    if (url) dispatcher = new ProxyAgent(url);
  }
  return dispatcher;
}

/** fetch() with the outbound dispatcher applied. */
export function outboundFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const d = outboundDispatcher();
  // `dispatcher` is an undici extension to RequestInit, not in the DOM types.
  return fetch(input, d ? ({ ...init, dispatcher: d } as RequestInit) : init);
}

/** Test seam: forget the memoised dispatcher. */
export function resetOutboundDispatcher(): void {
  dispatcher = undefined;
  resolved = false;
}
