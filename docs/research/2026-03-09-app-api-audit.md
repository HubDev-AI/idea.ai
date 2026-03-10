# 2026-03-09 App + API Audit

Scope: `apps/web`, `apps/api`, and the shared contracts/runtime code those surfaces depend on.

## Findings

### P1

1. Socket.IO bypasses the API-key gate and leaks the full operational snapshot to any client that can connect.
   - Evidence: `apps/api/src/main.ts:365-370` creates Socket.IO with no auth and wildcard-origin fallback; `apps/api/src/ws/state_hub.ts:60-75` emits `snapshot` immediately; `packages/contracts/src/ws.ts:11-22` shows that snapshot includes logs, infra status, AI health, refresh state, and counts.
   - This is worse than a plain status leak because the exposed log stream already contains prompt/output previews in multiple paths: `apps/api/src/jobs/agent_runner.ts:304-307`, `apps/api/src/jobs/agent_runner.ts:514-518`, `apps/api/src/jobs/deep_dive_generator.ts:87-90`, `apps/api/src/jobs/ai_post_scrape.ts:220-227`.
   - Impact: even when HTTP is protected with `X-Api-Key`, the websocket side channel still exposes internal operational data.
   - Recommended fix: add websocket auth/authorization, stop using wildcard origins as the default, and remove raw prompt/output previews from data that can reach clients.

2. The app renders untrusted upstream URLs directly into clickable anchors without scheme validation.
   - Evidence: `apps/web/src/components/SignalRow.tsx:22` and `apps/web/src/components/SignalRow.tsx:48` use `signal.source_url` directly in `href`. The API only surrogate-sanitizes that value in `apps/api/src/routes/feed.ts:63`, and the persistence path stores connector-provided URLs as-is in `apps/api/src/runtime/postgres_signal_store.ts:77-121`.
   - Impact: a poisoned connector payload can inject `javascript:` or `data:` URLs and turn the UI into an XSS/phishing launch point.
   - Recommended fix: normalize and allowlist URL schemes on ingest or before render (`http:` / `https:` only), and drop or neutralize anything else.

3. The HTTP control plane is public by default whenever `API_KEY` is unset, while the server still binds to `0.0.0.0`.
   - Evidence: `apps/api/src/main.ts:35-41` defaults to `HOST=0.0.0.0` with `API_KEY` optional; `apps/api/src/server.ts:117-128` only installs auth if a key exists. Expensive or state-changing routes remain callable in that mode, including `apps/api/src/routes/agent_status.ts:29-35`, `apps/api/src/routes/connectors.ts:34-46`, and `apps/api/src/routes/theses.ts:128-157` / `183-246`.
   - Impact: on any non-local deployment, unauthenticated clients can trigger research runs, refreshes, synthesis, and deep-dive generation.
   - Recommended fix: make auth opt-out only for explicit local development, or gate all mutating routes behind a deployment mode check.

### P2

4. The web client’s transport model is internally inconsistent for real deployments.
   - Evidence: REST calls honor `VITE_API_URL` in `apps/web/src/api.ts:37-46`, but `apps/web/src/useSocket.ts:50-52` calls `io()` with no base URL, so sockets always target the page origin. Separately, API-key mode cannot work with the shipped SPA because REST calls in `apps/web/src/api.ts:74-268` and the socket handshake in `apps/web/src/useSocket.ts:50-52` never send `x-api-key`, while the server enforces it in `apps/api/src/server.ts:117-124`.
   - Impact: split-origin deployments lose live updates/logs, and API-key-protected deployments break the SPA entirely instead of securing it.
   - Recommended fix: centralize transport config for both HTTP and websocket clients and decide on one deployable auth model for browsers (session/cookie, proxy injection, or same-origin private app only).

5. Manual refresh requests bypass the read model’s own in-flight refresh guard.
   - Evidence: the route fire-and-forgets work in `apps/api/src/routes/connectors.ts:34-46`; `apps/api/src/main.ts:258-279` calls `readModel.refresh(cadence)` directly; the guarded wrapper is `startRefresh()` in `apps/api/src/runtime/live_read_model.ts:956-964`, but the exported surface returns raw `refresh` at `apps/api/src/runtime/live_read_model.ts:1033`.
   - Impact: repeated `POST /v1/connectors/refresh` calls can stack overlapping ingestion and LLM work.
   - Recommended fix: expose only the guarded refresh entrypoint from the read model, or reject refresh requests while one is already running.

6. Deep-dive generation has no per-thesis in-flight dedupe.
   - Evidence: `apps/api/src/routes/theses.ts:199-226` checks cache once, then generates, then saves, with no lock keyed by thesis.
   - Impact: concurrent requests for the same thesis multiply CLI/LLM cost and latency until the first response commits.
   - Recommended fix: keep an in-memory promise map keyed by thesis key and fan out concurrent callers to the same in-flight work.

7. The paginated thesis API returns filtered rows with unfiltered summary stats.
   - Evidence: `apps/api/src/runtime/postgres_thesis_store.ts:228-232` applies `status/profile/label` filters to `countResult`, but `statsResult` at `apps/api/src/runtime/postgres_thesis_store.ts:233-248` recomputes totals across all theses without reusing `where` or `countParams`.
   - Impact: the UI can show filtered items next to totals that describe a different dataset.
   - Recommended fix: apply the same filter clauses to the stats query or return clearly separate global vs filtered stats.

8. `signalCount` and `latestSignalAt` go stale after the initial websocket snapshot.
   - Evidence: the websocket contract includes those fields in `packages/contracts/src/ws.ts:11-22`, and the client stores them in `apps/web/src/useSocket.ts:60-68`, but `apps/api/src/ws/state_hub.ts:128-139` only emits `signalCounts`, `thesisStats`, and `signalsUpdated` during live broadcasts. The sidebar still prefers `ws.signalCount` in `apps/web/src/App.tsx:420-421`.
   - Impact: the sidebar’s total count and “last update” can drift indefinitely after refreshes.
   - Recommended fix: emit `signalCount` and `latestSignalAt` on every broadcast or derive both from the data that is already updated live.

9. The log drawer contains a nested `<button>`, which matches the current test warning and is invalid interactive markup.
   - Evidence: `apps/web/src/App.tsx:752-783` renders `button.log-drawer-toggle`, and when open it nests another `button.log-action-btn` at `apps/web/src/App.tsx:767-778`.
   - Impact: broken semantics, inconsistent click/focus behavior, and accessibility regressions.
   - Recommended fix: make the header a non-button container with separate controls, or move the copy action outside the toggle button.

## Reuse / Extraction Candidates

1. Consolidate the frontend HTTP client.
   - `apps/web/src/api.ts` already centralizes base URL handling, but `apps/web/src/components/ScoringHealth.tsx:9-21`, `apps/web/src/components/ConnectionsView.tsx:22-51`, and `apps/web/src/components/OpportunityMap.tsx:33-41` still use ad-hoc `fetch()` calls.
   - Why extract: auth, base URL, retries, timeouts, and error handling are already drifting.

2. Extract the repeated thesis projection SQL in `apps/api/src/runtime/postgres_thesis_store.ts`.
   - The same aggregate/select shape is repeated in `:80-93`, `:100-110`, `:118-136`, and `:268-290`.
   - Why extract: schema changes or new derived fields will keep drifting across list/detail/paginated paths.

3. Extract small shared persistence helpers.
   - `toVectorLiteral` is duplicated across signal and journal persistence, and the execution log directory contract is duplicated between `apps/api/src/runtime/execution_logger.ts:25-27` and `apps/api/src/runtime/execution_log_reader.ts:5`.
   - Why extract: low code volume, high drift cost.

4. Reuse shared contract types and profile sources in the web app.
   - `apps/web/src/components/ThesisCard.tsx:4-32` re-declares most of `ThesisListItem` instead of consuming `packages/contracts/src/api.ts:120-139`.
   - `apps/web/src/App.tsx:174-176` / `:464-474` loads profiles dynamically, but `apps/web/src/components/ScoringHealth.tsx:31-45` hardcodes `consumer` and `b2b`.
   - Why extract: current duplication is already a contract drift risk.

5. Connector-level duplication is low overall, but the remaining clones are meaningful.
   - `pnpm dlx jscpd --min-tokens 60 --ignore '**/node_modules/**,**/dist/**,**/coverage/**' ...` found 9 first-party clones, 93 duplicated lines total (0.6%).
   - The useful clones were in `apps/api/src/runtime/postgres_thesis_store.ts`, `apps/api/src/jobs/agent_runner.ts`, `apps/api/src/routes/feed.ts` vs `apps/api/src/routes/logs.ts`, and connector pairs such as `packages/connectors/src/hn.ts` vs `packages/connectors/src/showhn.ts`.

## Verification Notes

- `pnpm lint` failed with 31 errors, 15 warnings, and 4 infos. The current failures are mostly import ordering, unused imports, and style issues rather than audit-critical correctness problems.
- `CI=1 pnpm test` passed across the workspace.
- The web test suite still emits React `act(...)` warnings and one DOM nesting warning; the nested-button issue above is the concrete product bug behind that warning.
