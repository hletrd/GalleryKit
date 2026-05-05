# Tracer — Cycle 3

## Traced Flows

### T1: SW network-first HTML → disturbed body
1. `fetch(request.clone())` resolves to `networkResponse`.
2. `new Response(networkResponse.body, { headers, status, statusText })` creates `responseToCache`.
   - The `Response` constructor takes ownership of the `ReadableStream`.
3. `htmlCache.put(request, responseToCache)` reads and stores the stream.
   - The underlying stream is now fully consumed.
4. `return networkResponse` returns the original response object.
   - `networkResponse.body` is a `ReadableStream` pointing to the same underlying source, which is now exhausted.
   - Browser receives an empty body.
- **Fix**: Tee the stream via `networkResponse.clone().body`.

### T2: Reactions POST → rollback after commit
1. `checkAndIncrementVisitorReaction` increments counters.
2. DB transaction (toggle reaction) commits.
3. Cookie refresh logic runs.
4. If step 3 throws, catch block fires.
5. `rollbackVisitorReaction` and `rollbackIpReaction` decrement counters.
6. Result: rate-limit budget is restored even though the reaction persisted.

### T3: Public route lint gate → regex bypass
1. Developer adds a new public POST route.
2. Developer includes a string literal: `const msg = "preIncrementFoo("`.
3. `checkPublicRouteSource` strips strings for exempt-tag but NOT for helper regex.
4. `usesPrefixHelper` matches the string literal.
5. Report passes even though no rate-limit helper is called.
