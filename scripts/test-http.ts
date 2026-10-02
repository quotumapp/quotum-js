import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const apiRoot = process.argv[2];
const packagePath = process.argv[3];
if (!apiRoot || !packagePath)
	throw new Error("Usage: bun scripts/test-http.ts <api-checkout> <tarball>");
const api = resolve(apiRoot);
const work = await mkdtemp(join(tmpdir(), "quotum-http-"));
try {
	await writeFile(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));
	execFileSync(
		"npm",
		["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", resolve(packagePath)],
		{
			cwd: work,
			stdio: "inherit",
			env: { ...process.env, npm_config_cache: join(work, "npm-cache") },
		},
	);
	const sdk = JSON.stringify(join(work, "node_modules/@quotum/sdk/dist/index.js"));
	const contract = JSON.parse(
		await readFile(join(work, "node_modules/@quotum/sdk/contracts/v1/source.json"), "utf8"),
	);
	const spec = await readFile(join(api, "contracts/v1/openapi.json"));
	if (createHash("sha256").update(spec).digest("hex") !== contract.sha256)
		throw new Error("The packed SDK and HTTP server contracts differ");
	if (!contract.workingTree) {
		const revision = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: api,
			encoding: "utf8",
		}).trim();
		const dirty = execFileSync(
			"git",
			[
				"status",
				"--porcelain",
				"--",
				"src",
				"scripts",
				"tests",
				"migrations",
				"contracts",
				"bun.lock",
				"package.json",
			],
			{ cwd: api, encoding: "utf8" },
		).trim();
		if (revision !== contract.revision || dirty)
			throw new Error("Conformance must use the clean pinned public API commit");
	}
	const helper = (name: string) => JSON.stringify(join(api, "tests/integration/helpers", name));
	const harness = `
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createQuotum } from ${sdk};
import { createLocalPostgresContext, describeLocalPostgres, integrationProjectContext } from ${helper("local-postgres.ts")};
import { resetAndSeedIntegrationData } from ${helper("catalog-fixtures.ts")};
import { publishAiCreditsCatalog } from ${helper("metering-catalog.ts")};
import { createIntegrationApp } from ${helper("app-fixture.ts")};
const lane = describeLocalPostgres(describe, describe.skip);
let context, server, account, entity;
lane("packed public SDK over real HTTP", () => {
 beforeAll(async () => {
  context = await createLocalPostgresContext();
  await resetAndSeedIntegrationData(context.sql);
  await publishAiCreditsCatalog(context.repository);
  const fixture = createIntegrationApp(context);
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: request => fixture.app.handle(request)});
  const authorization = new Headers(fixture.authHeaders()).get("authorization");
  if (!authorization) throw new Error("Missing disposable test credential");
  let dropped = false;
  const quotum = createQuotum({baseUrl: server.url.origin, apiKey: authorization.slice(7), maxRetries: 0,
   fetch: async (url, init) => {
    const response = await fetch(url, init);
    if (url.endsWith("/usage/consume") && response.ok && !dropped) {
     dropped = true; await response.text(); throw new Error("Simulated response loss after commit");
    }
    return response;
   }
  });
  account = quotum.account("packed-payer");
  entity = account.entity("workspace/packed");
 });
 afterAll(async () => { server?.stop(true); await context?.sql.close(); });
 it("creates an account and entity, consumes, recovers a lost response and reads exactly one receipt", async () => {
  expect(await account.create()).toMatchObject({id: "packed-payer"});
  expect(await account.get()).toMatchObject({id: "packed-payer"});
  expect(await entity.create({kind: "workspace"})).toMatchObject({externalId: "workspace/packed"});
  expect(await entity.get()).toMatchObject({externalId: "workspace/packed"});
  await context.repository.grantAllocation(integrationProjectContext(), {billingAccountId: "packed-payer", featureKey: "ai_credits", quantity: "10", sourceKind: "credit_grant", sourceKey: "test-grant"});
  expect(await entity.check({featureId: "model_tokens", value: 100n})).toMatchObject({allowed: true, kind: "metered"});
  const result = await entity.consume({featureId: "model_tokens", value: 100, operationId: "packed/job"});
  expect(result).toMatchObject({allowed: true, rated: {value: "0.5"}, balance: {available: "9.5"}});
  expect((await entity.getOperation({operation: "consume", operationId: "packed/job"})).outcome).toEqual(result);
  if (!result.allowed) throw new Error("consume was denied");
  expect(typeof result.usageEventId === "string" && result.usageEventId.length > 0).toBe(true);
  expect(await entity.getReceipt(result.receiptId)).toMatchObject({receiptId: result.receiptId, usageEventId: result.usageEventId, billingAccountId: "packed-payer", entityId: "workspace/packed", deductionCount: 1});
  expect((await entity.listReceiptDeductions({receiptId: result.receiptId, limit: 1})).items).toHaveLength(1);
  await expect(account.getReceipt(result.receiptId)).rejects.toMatchObject({code: "RECEIPT_NOT_FOUND", status: 404});
  expect(await entity.consume({featureId: "model_tokens", value: "100.000", operationId: "packed/job"})).toEqual(result);
  const [count] = await context.sql\x60SELECT count(*)::int AS events FROM usage_events\x60;
  expect(count.events).toBe(1);
 });
});
`;
	const test = join(work, "packed-sdk.test.ts");
	await writeFile(test, harness);
	execFileSync("bun", ["run", "test:integration", test], {
		cwd: api,
		stdio: "inherit",
		timeout: 180_000,
	});
} finally {
	await rm(work, { recursive: true, force: true });
}
