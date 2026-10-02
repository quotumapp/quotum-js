import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const root = new URL("../", import.meta.url);
const specFile = new URL("contracts/v1/openapi.json", root);
const sourceFile = new URL("contracts/v1/source.json", root);
const typesFile = new URL("src/generated/http.ts", root);
const coverageFile = new URL("contracts/v1/coverage.json", root);
const surfaceFile = new URL("SURFACE.md", root);
const methods = JSON.parse(
	await readFile(new URL("contracts/v1/methods.json", root), "utf8"),
) as Record<string, string>;
const repository = "https://github.com/quotumapp/quotum";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const command = process.argv[2] ?? "generate";
await mkdir(new URL("src/generated/", root), { recursive: true });
if (command === "preview") {
	const apiRoot = process.argv[3];
	if (!apiRoot) throw new Error("Provide an API checkout: bun run api:preview <path>");
	const spec = await readFile(resolve(apiRoot, "contracts/v1/openapi.json"), "utf8");
	JSON.parse(spec);
	const revision = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: apiRoot,
		encoding: "utf8",
	}).trim();
	await writeFile(specFile, spec);
	await writeFile(
		sourceFile,
		`${JSON.stringify({ repository, revision, sha256: digest(spec), workingTree: true }, null, 2)}\n`,
	);
}
if (command === "update") {
	const revision = process.argv[3];
	if (!revision || !/^[a-f0-9]{40}$/.test(revision))
		throw new Error("Provide a full public API commit SHA");
	const response = await fetch(
		`https://raw.githubusercontent.com/quotumapp/quotum/${revision}/contracts/v1/openapi.json`,
	);
	if (!response.ok) throw new Error(`Contract download failed: ${response.status}`);
	const spec = await response.text();
	JSON.parse(spec);
	await writeFile(specFile, spec);
	await writeFile(
		sourceFile,
		`${JSON.stringify({ repository, revision, sha256: digest(spec) }, null, 2)}\n`,
	);
}
const spec = await readFile(specFile, "utf8");
const source = JSON.parse(await readFile(sourceFile, "utf8")) as {
	repository: string;
	revision: string;
	sha256: string;
	workingTree?: boolean;
};
if (
	source.repository !== repository ||
	!/^[a-f0-9]{40}$/.test(source.revision) ||
	source.sha256 !== digest(spec)
)
	throw new Error("Contract provenance is invalid");
if (source.workingTree && command !== "preview" && command !== "check-preview")
	throw new Error(
		"A working-tree contract cannot produce a release candidate; pin its public API commit first",
	);
const document = JSON.parse(spec);
const types = astToString(await openapiTS(document, { alphabetize: true }));
const implemented = new Map([
	["putV1BillingAccountsByBillingAccountId", "account.create"],
	["getV1BillingAccountsByBillingAccountId", "account.get"],
	["postV1BillingAccountsByBillingAccountIdEntities", "account.entity.create"],
	["getV1BillingAccountsByBillingAccountIdEntitiesByEntityId", "account.entity.get"],
	["postV1BillingAccountsByBillingAccountIdUsageCheck", "account.check / entity.check"],
	["postV1BillingAccountsByBillingAccountIdUsageConsume", "account.consume / entity.consume"],
	[
		"getV1BillingAccountsByBillingAccountIdUsageOperationsByOperationByOperationId",
		"account.getOperation / entity.getOperation (consume)",
	],
	[
		"getV1BillingAccountsByBillingAccountIdUsageReceiptsByReceiptId",
		"account.getReceipt / entity.getReceipt",
	],
	[
		"getV1BillingAccountsByBillingAccountIdUsageReceiptsByReceiptIdDeductions",
		"account.listReceiptDeductions / entity.listReceiptDeductions",
	],
]);
const rows: object[] = [];
const publicOperations = new Set<string>();
const surfaceRows: string[] = [];
for (const [path, item] of Object.entries(document.paths)) {
	if (!path.startsWith("/v1/")) continue;
	for (const [method, value] of Object.entries(item as object)) {
		if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
		const operation = value as { operationId: string; security?: Record<string, unknown>[] };
		const security = operation.security ?? [];
		const client = security.some((scheme) => "operatorKey" in scheme)
			? "operator"
			: security.some((scheme) => "projectKey" in scheme || "gatewayProject" in scheme)
				? "application"
				: "excluded_ingress";
		if (client !== "excluded_ingress") {
			publicOperations.add(operation.operationId);
			if (!methods[operation.operationId])
				throw new Error(`Public method missing: ${operation.operationId}`);
		}
		const status = implemented.has(operation.operationId)
			? "preview"
			: client === "excluded_ingress"
				? "excluded"
				: "planned";
		rows.push({
			method: method.toUpperCase(),
			path,
			operationId: operation.operationId,
			client,
			status,
			methodName: methods[operation.operationId] ?? null,
		});
		surfaceRows.push(
			`| ${methods[operation.operationId] ?? "Webhook ingress"} | ${client} | ${status} | \`${method.toUpperCase()} ${path}\` |`,
		);
	}
}
const coverage = `${JSON.stringify(rows, null, 2)}\n`;
for (const id of Object.keys(methods)) {
	if (!publicOperations.has(id)) throw new Error(`Method has no trusted HTTP operation: ${id}`);
}
const surface = `# SDK operation surface\n\nGenerated from the pinned HTTP contract and the authored method inventory. Only rows marked\n\`preview\` have runtime methods. \`account\` means \`quotum.account(id)\`; \`account.entity\` means\n\`account.entity(id)\`; \`operator.account\` is a future operator-scoped handle. All other rows\nare reviewed targets, not stubs or promises that their current wire is already final.\n\nGenerated \`HttpOperations[operationId]\` defines each operation's HTTP inputs/responses; see\n[the machine-readable coverage](contracts/v1/coverage.json) for its exact operation ID. Public\nmethods bind path scope, take an input object for the remaining domain fields and final request\noptions, and return a promise of the unwrapped data. Reads with no remaining inputs omit that\nobject. Existing preview signatures are authoritative in [src/types.ts](src/types.ts).\n\n| Public method | Client | Delivery | HTTP operation |\n| --- | --- | --- | --- |\n${surfaceRows.join("\n")}\n`;
if (command.startsWith("check")) {
	if ((await readFile(typesFile, "utf8")) !== types)
		throw new Error("Generated HTTP types are stale");
	if ((await readFile(coverageFile, "utf8")) !== coverage)
		throw new Error("Operation coverage is stale");
	if ((await readFile(surfaceFile, "utf8")) !== surface) throw new Error("Public surface is stale");
	if (command === "check-release") {
		const response = await fetch(
			`https://raw.githubusercontent.com/quotumapp/quotum/${source.revision}/contracts/v1/openapi.json`,
		);
		if (!response.ok || digest(await response.text()) !== source.sha256)
			throw new Error("The public API revision does not contain the tested contract");
		const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
		if (pkg.version !== "0.1.0-rc.0")
			throw new Error("The first release candidate must use version 0.1.0-rc.0");
	}
} else {
	await writeFile(typesFile, types);
	await writeFile(coverageFile, coverage);
	await writeFile(surfaceFile, surface);
}
