# Public SDK design

## Contract ownership

Quotum owns billing, transactions, authorization, catalog policy, HTTP schemas and error codes.
The SDK owns ergonomic handles, precise value normalization, transport and bounded recovery.
OpenAPI is copied from a full public API commit and SHA-256 checked; generated HTTP types and the
operation coverage inventory are committed. [SURFACE.md](SURFACE.md) names all 100 trusted
operations and marks the nine implemented HTTP operations; generation fails on an unmapped addition. The SDK has no server runtime or private repository dependency.
A local working-tree contract is allowed for development and rejected by release checks.

## Application and operator clients

`createQuotum({ baseUrl, apiKey, fetch?, timeoutMs?, maxRetries? })` constructs the application client.
The first preview implements the account/entity methods documented in README. All methods are
promise-returning bound functions, return plain objects, and accept a final request-options argument.
Account and entity identity comes from their handle, not from a repeated input field.

The full application target groups trusted APIs as follows. Every specific HTTP operation and its
generated request/response schema is enumerated in `contracts/v1/coverage.json` and `HttpOperations`.

| Owner / handle | Target capabilities |
| --- | --- |
| `quotum.catalog` | Published catalog and provider sale catalogs |
| `quotum.providers` | Capability declarations and available connected-provider actions |
| `quotum.account(id)` | Explicit account, entitlements, billing summary, available actions |
| Account and entity usage | `check`, `consume`, `reserve`, `confirm`, `release`, policy-permitted `track`, operation lookup, receipts and paginated deductions |
| `account.entity(id)` | Entity create/get, listing through the account, scoped usage and licensing |
| Account commercial actions | Preview/execute checkout, subscription changes, cancellation, payment setup and session retrieval |
| Account purchases and subscriptions | Provider verification/linking, purchase and subscription reads and supported lifecycle operations |
| Account policies | Controls, usage alerts, automatic top-ups and license assignments |
| Account grants and promotions | Trial eligibility/lifecycle, promotion validation/redemption and account redemptions |
| Account insights | Usage events, series and balance allocation provenance |

The target operator factory is separate:
`createQuotumOperator({ baseUrl, apiKey, operatorKey, actor, fetch?, timeoutMs?, maxRetries? })`.
It groups catalog preview/publish, contracts and migrations, grants/debits, promotion
administration and operator jobs. Application credentials retain the project-authorized support
reads and usage corrections declared by OpenAPI. Audited mutations require an explicit actor
and refuse before dispatch if it is absent. The coverage manifest classifies operations by OpenAPI security, not `/admin`
path prefixes. Project-authenticated catalog reads remain application operations.

No operator factory, reservation helper or checkout stub is exported in the first preview.
Merchant `/api`, provider webhook ingress and MCP transport are not SDK outbound-client surfaces.
Gateway authentication is deferred. The feature-descriptor generator is a separate CLI package;
customer-token browser hooks are another package and never accept project API keys.

## Usage semantics

Known-cost work consumes before execution. Unknown-cost AI work reserves an upper bound and
confirms a positive actual value no greater than that bound; zero actual usage releases the hold.
Post-fact tracking is a distinct server operation admitted only by published non-gating/postpaid
policy. It is never a fallback for denied consumption.

Expected denial is a discriminated result. Configuration, missing accounts/features/entities,
unsupported actions, authentication and infrastructure failures are typed errors. Every mutation
uses caller-owned operation identity and records its outcome atomically with billing and projection
intent. Successful consume/confirm/track outcomes carry one opaque receipt identity. Checks have no
operation identity; boolean checks omit amounts and balances. Hot-path results exclude allocations,
deductions, rate tiers, purchase-action arrays and arbitrary metadata.

Entity scope is exact: account usage spends the shared pool; entity usage may spend entity credit
and the shared pool. Receipt reads and operation recovery retain the handle's entity scope. The server
is authoritative; generated feature descriptors and checks cannot authorize future work offline.

## Delivery gates

The first working preview implements explicit accounts/entities, checks, consumption, recovery and
receipts, with API-key authentication. It is independently versioned from the HTTP API. During
pre-1.0 cutover, update affected API, bundled-client, MCP, merchant and UI callers together; no legacy
aliases are added to check/consume. Deferred reservation/correction endpoints retain their existing
wire contract until their coordinated increment.

A release candidate requires the public API commit containing this contract, `api:check-release`,
the exact packed JS/TS runtime matrix, real HTTP conformance, tarball checksum and test evidence.
`0.1.0-rc.0` is the first candidate version; npm publication is a later action. A dirty contract uses
`0.1.0-dev.1` and must not be presented as a completed release candidate.

Before 1.0, complete all trusted operation families, reserve/confirm/release and checkout/subscription
journeys, deployed-server conformance, and adoption of all three workflow families. A package build
or mock transport test alone is insufficient evidence of billing correctness.

## Server prerequisites and later workflows

| Capability | Current preview | Before exporting the later method |
| --- | --- | --- |
| Accounts/entities | Explicit idempotent account PUT/GET, entity create/get and exact scopes | Entity access checks must remain authoritative for reservation lookups |
| Check/consume | Final field names, feature-kind validation, compact outcomes and version-2 recovery | Keep canonical input and atomic receipt/outcome semantics across server changes |
| Receipts | Immutable consume snapshot, bounded deduction pages, opaque IDs | Extend receipt kinds and reservation references for confirm/track |
| Reserve/confirm/release | Existing server-only wire retained | Adopt public field/result shapes and pinned TTL semantics; add reservation reads and uncertainty tests |
| Track | No server route or SDK method | Publish non-gating/postpaid policy and implement an independent post-fact operation |
| Commercial actions | Existing server preview/execute retained | Account-bound methods, exact provider capability checks, endpoint-specific reconciliation |
| Catalog/feature types | Generated HTTP DTOs and complete endpoint inventory | Separate CLI to generate project feature capabilities; runtime authority stays server-side |
| Release | Development tarball pinned to a public API commit | Matching consumer updates and the exact RC conformance artifact |

Later usage signatures follow `reserve({ featureId, value, operationId, expiresInSeconds? })`,
`confirm({ reservationId, value, operationId })`, `release({ reservationId, operationId })`,
`getReservation(reservationId)` and `track({ featureId, value, operationId, occurredAt? })`, each
with final request options and the same bound account/entity scope. These are target signatures;
they become exports only with their accepted server contracts. Reserve's value is an upper bound,
confirm's is positive actual usage within it, and zero actual usage uses release. `track` returns
a receipt or a typed error, with no authorization verdict.

Commercial target calls are `account.commercial.preview(input, options?)` and
`account.commercial.execute({ previewToken, operationId }, options?)`; result and action unions
come from the corresponding generated HTTP operation. A completed browser return does not prove
payment: read authoritative checkout/subscription state before consuming its entitlements.
Plain reads, provider-creating GETs and audited writes have separate retry rules; verb alone is
never permission to retry. A known-cost consumption authorizes billing once, while the application
must separately ensure the protected job itself does not execute twice after a replay.
