# quotum-js

Quotum's JavaScript and TypeScript SDK for trusted product backends.

## Status

This repository is at the design stage. The SDK implementation, package build, and release
automation are not present yet. The intended distribution is an independently versioned
`@quotum/sdk` npm package, with public source on GitHub under Apache-2.0.

## JavaScript and TypeScript

One TypeScript implementation will produce compiled ESM JavaScript and TypeScript declarations.
JavaScript applications will consume the runtime directly; TypeScript applications will use the
same package with declarations. Consumers will not need to transpile this repository's TypeScript
source. The initial package targets ES2022 and ESM.

The planned runtime conformance matrix covers Node.js 22 and 24, Bun 1.4 or newer, Cloudflare Module
Workers, and Deno 2 through npm. These are validation targets, not claims of tested compatibility.
Project credentials belong in trusted backends. Customer-token browser hooks and the CLI have
separate package boundaries.

## Repository boundary

This repository owns the SDK source, public usage documentation and examples, tests, package
artifacts, and SDK release process. Quotum's API repository owns the HTTP contract and billing
semantics. The SDK will generate wire types from a pinned public contract and implement ergonomic
account/entity methods without importing server implementation modules.

The published package and its standalone build must work without a private sibling checkout.
Contract adoption must identify the source API revision and pass compatibility checks before a
release. Billing authorization, accounting, and durable operation outcomes remain server-owned.

## Planned workflows

- Known-cost work: consume a known quantity before starting protected work and recover uncertain
  responses using the same caller-owned operation identity.
- Unknown-cost AI work: reserve an upper bound, then confirm actual usage or release unused work.
- Subscriptions: preview and execute checkout, observe authoritative completion, then use the
  resulting entitlements and limits.

Post-fact tracking applies only where the published policy permits non-gating/postpaid usage.
The SDK will progress through focused `0.y` previews before its full `1.0` compatibility contract.

## License

[Apache-2.0](LICENSE).
