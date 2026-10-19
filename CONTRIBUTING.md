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
snapshots cannot satisfy that remote gate. The tag-triggered `release.yml` workflow publishes the exact tested tarball under `next` through
npm trusted publishing. It requires both SDK and pinned API commits on their main branches,
Node 22/24 plus Bun/Deno/Workers packed conformance, real HTTP including the reference application,
and the protected `npm` environment. Set the environment protection rules and publisher trust
before approving the publish job. npm requires the package to exist before trusted publishing can
be configured ([npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites)).
An anonymous registry 404 may also indicate a private package: the scope owner first checks it
while authenticated. If the package is new, use a separately reviewed, functional SDK bootstrap
artifact at `0.0.0-bootstrap.0` to create it once. The bootstrap changes only candidate package
metadata and README, must pass packed/runtime and real-HTTP conformance, and is published by the
owner interactively under `bootstrap`. Keep `0.1.0-rc.0` unused for the OIDC workflow:

```sh
npm login
npm publish /path/to/quotum-sdk-0.0.0-bootstrap.0.tgz --access public --tag bootstrap --ignore-scripts
```

The bootstrap is a proposed one-time owner action, not an automated release or provenance evidence.
Once the package exists, the npm scope owner configures:

```sh
npm trust github @quotum/sdk --repo quotumapp/quotum-js --file release.yml --environment npm --allow-publish
npm trust list @quotum/sdk
```

Do not add an npm write token to CI. `v0.1.0-rc.0` is the first tag; later RCs increment `rc.N`.
The separate verification job checks registry integrity, the `next` tag and a clean installation.
It runs `npm audit signatures --json --include-attestations` to verify Sigstore trust evidence,
then checks the verified npm GitHub Actions SLSA v1 bundle against the exact tarball digest,
release workflow identity and `GITHUB_SHA`. Unknown provenance formats fail closed. If registry
visibility or verification fails after publication, rerun failed jobs to retry verification without
publishing that immutable version again. Metadata visibility is retried 36 times at ten-second
intervals, with bounded request timeouts.
An ownership/setup failure leaves a tested candidate; it is not a published release. Keep a development
snapshot at `0.1.0-dev.1` until the public source pin and candidate gates are satisfied.

Do not log API keys or include `.env` files, real credentials or private server imports in artifacts.
An uncertain consume preserves its operation identity: do not retry with a replacement key or
convert an infrastructure failure into a business denial.
