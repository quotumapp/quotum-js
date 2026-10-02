# Contributing

Use Bun 1.4.x to install the committed lockfile and run `bun run quality` and `bun run build`.
Runtime code under `src/` must use Web APIs, stay dependency-free, avoid environment reads, and
remain portable to Node 22/24, Bun, Deno npm compatibility and Cloudflare Module Workers.

The API repository owns schemas and billing semantics. Use `bun run api:update <full-public-sha>`
for deliberate contract adoption, or `bun run api:preview <api-checkout>` for an explicitly
unreleasable local snapshot. Commit generated HTTP types, coverage, surface and provenance together.
`contracts/v1/methods.json` names every trusted operation; new endpoints require an explicit
surface decision. Feature-catalog generation belongs to the separate CLI, not this HTTP generator.

Before a release candidate, pin the publicly readable API commit, set the first candidate version
to `0.1.0-rc.0`, run `bun run api:check-release` and `bun run quality`, then `bun run pack:rc`.
Run `bun run test:packed <tarball> --node-lts` with Node, Bun and Deno installed, and
`bun run test:http <matching-api-checkout> <tarball>` with Docker. Record the tarball SHA-256 and
reports for that exact API/SDK pair. The HTTP test creates a disposable database through the API's
guarded lane; production credentials and databases are never test inputs.

CI validates packed consumers; its HTTP job uses the immutable public API pin. Working-tree
snapshots cannot satisfy that remote gate. This repository has no npm publication workflow yet;
maintainers, npm ownership and publication remain a separate release step. Keep a development
snapshot at `0.1.0-dev.1` until the public source pin and candidate gates are satisfied.

Do not log API keys or include `.env` files, real credentials or private server imports in artifacts.
An uncertain consume preserves its operation identity: do not retry with a replacement key or
convert an infrastructure failure into a business denial.
