# Quotum JavaScript and TypeScript SDK

`@quotum/sdk` is the backend client for [Quotum](https://github.com/quotumapp/quotum).
One TypeScript implementation emits ESM JavaScript and declarations, targeting ES2022 with no
runtime dependencies. Licensed under Apache-2.0.

This is a development preview, pinned to the public API commit in `contracts/v1/source.json`.
The API cutover is under review in [quotum#206](https://github.com/quotumapp/quotum/pull/206);
this package has not been published to npm. Install a tested local or CI tarball:

```sh
npm install /path/to/quotum-sdk-0.1.0-dev.1.tgz
```

```js
import { createQuotum, QuotumAmbiguousOperationError } from '@quotum/sdk';

// Supply configuration explicitly from your backend's secret store.
const quotum = createQuotum({ baseUrl, apiKey });
const account = quotum.account('customer-123');
await account.create();
const workspace = account.entity('workspace-456');
await workspace.create({ kind: 'workspace' });

try {
  const result = await workspace.consume({
    featureId: 'model_tokens',
    value: '150',
    operationId: job.id,
  });
  if (result.allowed) {
    await performKnownCostWork();
    const receipt = await workspace.getReceipt(result.receiptId);
    // Save the receipt ID with the business operation if you need later reconciliation.
  } else {
    handleDeniedUsage(result.reason);
  }
} catch (error) {
  if (error instanceof QuotumAmbiguousOperationError) {
    // Do not run or charge again under a new operationId.
    // Reconcile with the same scoped handle and identity when connectivity returns.
    const state = await workspace.getOperation({
      operation: error.operation,
      operationId: error.operationId,
    });
    reconcileJob(state);
  } else {
    throw error;
  }
}
```

The same imports work in TypeScript with inferred discriminated results. `result.receiptId` and
`result.usageEventId` exist only in the allowed branch; denied results expose `reason`. Corrections
address the usage event by `usageEventId`. A balance's `granted` and `available` are `null` when
`unlimited: true`, and a meter-limited balance adds its `scope` with `windowStartAt` and
`windowEndAt`. Account and entity handles are immutable, create no network traffic, and support
destructured methods. `create()` performs network I/O.

## Preview methods

- `account.create()` / `account.get()` explicitly create or retrieve a provider-independent account.
  Creation is idempotent and does not replace its email, metadata or creation time.
- `account.entity(id).create({ kind, metadata? })` / `.get()` use the existing entity resource.
  Entity creation/upsert is not retried automatically.
- `account.check({ featureId, value?, occurredAt? })` and `entity.check(...)` are advisory reads.
  Boolean features omit `value`; metered features require it.
- `account.consume({ featureId, value, operationId, occurredAt? })` and `entity.consume(...)`
  authorize and record known-cost usage before work. These return compact outcomes.
- `getOperation({ operation: 'consume', operationId })` returns processing or the exact completed outcome.
- `getReceipt(receiptId)` returns immutable receipt detail; `listReceiptDeductions({ receiptId,
  cursor?, limit? })` returns one page, default 50 and maximum 100. Receipts and cursors are opaque.

Every network method takes optional `{ signal, timeoutMs, maxRetries, requestId }` as its last
argument. All preview operations use project API keys; read-only keys can call reads and checks.
Accounts and entities must exist before usage. Identifiers are case-sensitive and reject surrounding
whitespace. Dot-only path segments and control characters are not addressable through this client.
Operation IDs are 1–200 printable ASCII characters and travel unchanged in `Idempotency-Key`.

Values accept positive `bigint`, safe-integer `number`, or decimal strings. Fractions require strings;
scientific notation, whitespace, zero and negative usage are rejected. Redundant leading and trailing
zeroes normalize before dispatch. Canonical values
allow at most 19 integer digits and nine fractional places; the server enforces each feature's scale.
`occurredAt`, when used, is an ISO timestamp with a timezone and at most millisecond precision.
Usage input does not accept filters or metadata. Entity resource metadata is separate.

## Failures and recovery

Expected denials are successful HTTP responses with `allowed: false`. Other failures throw
`QuotumError` with `code`, `status`, `requestId`, `retryable` and `retryAfterMs` (unavailable transport
values are `null`). Authentication, configuration, invalid input and conflicts are not retried.

A call has one total deadline, default 10 seconds, including response bodies, backoff and lookup.
At most two retries are allowed. Transient network/408/429/500/502/503/504 failures use jitter and
respect `Retry-After`. Consumption retries retain the exact canonical body and operation key. An
uncertain outcome triggers one final lookup within the same deadline, including when retries are zero.
An in-progress response moves directly to lookup. Lookup absence does not establish rollback.

Pre-dispatch cancellation throws `REQUEST_ABORTED`. If a dispatched consume may have committed,
abort, deadline expiry or unresolved recovery throws `QuotumAmbiguousOperationError` with account,
entity, operation ID, last request ID and latest known state. No background retries continue after
cancellation. Account creation is safely retryable; arbitrary entity upserts are not automatically retried.

## Runtimes and development

The packed-artifact matrix covers Node.js 22/24, Bun 1.4+, Cloudflare Workers without `nodejs_compat`,
and Deno 2 npm compatibility. DOM browser construction rejects backend credential use. The SDK
reads no environment variables and accepts an explicit `fetch` implementation.

```sh
bun install --frozen-lockfile
bun run quality
bun run build
bun run api:check-preview                 # current local contract
bun run pack:preview
bun scripts/test-packed.ts ./quotum-sdk-0.1.0-dev.1.tgz --node-lts
bun scripts/test-http.ts /path/to/quotum-api ./quotum-sdk-0.1.0-dev.1.tgz
```

Builds use the committed types and work offline. Contract updates are deliberate:

```sh
bun run api:preview /path/to/quotum-api    # explicitly unreleasable local preview
bun run api:update <full-public-api-sha>  # fetch immutable public contract and regenerate
bun run api:check                        # offline provenance/type/coverage check
```

See [the public design](DESIGN.md) and [operation coverage](contracts/v1/coverage.json) for the
complete target. The API owns HTTP schemas and billing semantics. Generated HTTP types describe
all trusted endpoints; runtime methods only expose the implemented preview slice.
