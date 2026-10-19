import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
	const example = join(work, "ai-reservations.mjs");
	await cp(new URL("../examples/ai-reservations.mjs", import.meta.url), example);
	const helper = (name: string) => JSON.stringify(join(api, "tests/integration/helpers", name));
	const harness = `
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createQuotum } from ${sdk};
import { createLocalPostgresContext, describeLocalPostgres, integrationProjectContext } from ${helper("local-postgres.ts")};
import { resetAndSeedIntegrationData } from ${helper("catalog-fixtures.ts")};
import { publishAiCreditsCatalog } from ${helper("metering-catalog.ts")};
import { createIntegrationApp } from ${helper("app-fixture.ts")};
const lane = describeLocalPostgres(describe, describe.skip);
let context, server, account, entity, quotum, credential;
lane("packed public SDK over real HTTP", () => {
 beforeAll(async () => {
  context = await createLocalPostgresContext();
  await resetAndSeedIntegrationData(context.sql);
  await publishAiCreditsCatalog(context.repository);
  const fixture = createIntegrationApp(context);
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: request => fixture.app.handle(request)});
  const authorization = new Headers(fixture.authHeaders()).get("authorization");
  if (!authorization) throw new Error("Missing disposable test credential");
  const dropped = new Set();
  credential = authorization.slice(7);
  quotum = createQuotum({baseUrl: server.url.origin, apiKey: authorization.slice(7), maxRetries: 0,
   fetch: async (url, init) => {
    const response = await fetch(url, init);
    const phase = init.method === "POST" ? url.endsWith("/usage/consume") ? "consume" : url.endsWith("/reservations") ? "reserve" : url.endsWith("/confirm") ? "confirm" : url.endsWith("/release") ? "release" : null : null;
    if (phase && response.ok && !dropped.has(phase)) {
     dropped.add(phase); await response.text(); throw new Error("Simulated response loss after commit");
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
 it("recovers reserve, confirm and release over HTTP without duplicating holds or usage", async () => {
  const ai = quotum.account("packed-ai");
  await ai.create();
  await context.repository.grantAllocation(integrationProjectContext(), {billingAccountId: "packed-ai", featureKey: "ai_credits", quantity: "10", sourceKind: "credit_grant", sourceKey: "ai-grant"});
  const workspace = ai.entity("ai-workspace");
  await workspace.create({kind: "workspace"});
  const hold = await workspace.reserve({featureId: "model_tokens", value: 100n, operationId: "generation"});
  expect(hold.allowed).toBe(true);
  if (!hold.allowed) throw new Error("reserve was denied");
  expect((await workspace.getOperation({operation: "reserve", operationId: "generation"})).outcome).toEqual(hold);
  await expect(ai.confirm({reservationId: hold.reservationId, value: 60, operationId: "wrong-scope"})).rejects.toMatchObject({code: "RESERVATION_NOT_FOUND"});
  const confirmed = await workspace.confirm({reservationId: hold.reservationId, value: 60, operationId: "generation"});
  expect(confirmed).toMatchObject({allowed: true, status: "confirmed", balance: {held: "0", available: "9.7"}});
  if (!confirmed.allowed) throw new Error("confirm was denied");
  expect(await workspace.getReceipt(confirmed.receiptId)).toMatchObject({operation: "confirm", reservationId: hold.reservationId, entityId: "ai-workspace"});
  expect((await workspace.getOperation({operation: "confirm", operationId: "generation"})).outcome).toEqual(confirmed);
  const unused = await workspace.reserve({featureId: "model_tokens", value: 100, operationId: "unused"});
  if (!unused.allowed) throw new Error("second reserve was denied");
  const released = await workspace.release({reservationId: unused.reservationId, operationId: "unused"});
  expect(released.status).toBe("released");
  expect((await workspace.getOperation({operation: "release", operationId: "unused"})).outcome).toEqual(released);
  expect((await workspace.getReservation(unused.reservationId)).status).toBe("released");
  const [count] = await context.sql\x60SELECT count(*)::int AS events FROM usage_events WHERE project_id = \${integrationProjectContext().projectInstanceId} AND reservation_id = \${hold.reservationId}\x60;
  expect(count.events).toBe(1);
 });
 it("runs the installed reference application through restart, response loss, zero usage, denial and expiry", async () => {
  await quotum.account("reference-app").create();
  await context.repository.grantAllocation(integrationProjectContext(), {billingAccountId: "reference-app", featureKey: "ai_credits", quantity: "10", sourceKind: "credit_grant", sourceKey: "reference-grant"});
  const run = async (...args) => {
   const child = Bun.spawn(["node", ${JSON.stringify(example)}, "--state-dir", ${JSON.stringify(join(work, "jobs"))}, ...args], {
    env: {PATH: process.env.PATH, QUOTUM_BASE_URL: server.url.origin, QUOTUM_API_KEY: credential, QUOTUM_ACCOUNT_ID: "reference-app"}, stdout: "pipe", stderr: "pipe"});
   const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
   expect(stdout.includes(credential) || stderr.includes(credential)).toBe(false);
   return {code, stdout, stderr};
  };
  const stopped = await run("--job", "restart", "--crash-after-work");
  expect(stopped.code).not.toBe(0);
  const restarted = await run("--job", "restart", "--drop-response", "confirm");
  expect(restarted.code).toBe(0);
  expect(JSON.parse(restarted.stdout)).toMatchObject({phase: "confirmed", workRuns: 1, actualValue: "60"});
  for (const [scenario, phase] of [["zero", "released"], ["denied", "denied"], ["expired", "expired"]]) {
   const result = await run("--job", scenario, "--scenario", scenario, "--drop-response", scenario === "zero" ? "release" : "reserve");
   expect(result.code).toBe(0);
   expect(JSON.parse(result.stdout)).toMatchObject({phase, workRuns: scenario === "zero" ? 1 : 0});
  }
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
	await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
	await writeFile(
		new URL("../artifacts/http-report.json", import.meta.url),
		`${JSON.stringify(
			{
				apiRevision: contract.revision,
				apiSha256: contract.sha256,
				workingTree: contract.workingTree === true,
				tarballSha256: createHash("sha256")
					.update(await readFile(resolve(packagePath)))
					.digest("hex"),
				scenarios: [
					"consume recovery",
					"reservation recovery",
					"confirmation recovery",
					"release recovery",
					"entity isolation",
					"reference application restart",
					"zero usage",
					"denial",
					"logical expiry",
				],
			},
			null,
			2,
		)}\n`,
	);
} finally {
	await rm(work, { recursive: true, force: true });
}
