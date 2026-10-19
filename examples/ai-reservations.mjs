import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createQuotum } from "@quotum/sdk";

const { values } = parseArgs({
	options: {
		job: { type: "string" },
		scenario: { type: "string", default: "partial" },
		"state-dir": { type: "string", default: ".quotum-example" },
		"crash-after-work": { type: "boolean", default: false },
		"drop-response": { type: "string" },
	},
});
const {
	QUOTUM_BASE_URL: baseUrl,
	QUOTUM_API_KEY: apiKey,
	QUOTUM_ACCOUNT_ID: accountId,
	QUOTUM_ENTITY_ID: entityId,
} = process.env;
if (!baseUrl || !apiKey || !accountId || !values.job)
	throw new Error(
		"Set QUOTUM_BASE_URL, QUOTUM_API_KEY and QUOTUM_ACCOUNT_ID; pass --job <durable-id>",
	);
if (!["partial", "zero", "denied", "expired"].includes(values.scenario))
	throw new Error("Unknown scenario");
if (values["drop-response"] && !["reserve", "confirm", "release"].includes(values["drop-response"]))
	throw new Error("Unknown response-loss phase");

const directory = resolve(values["state-dir"]);
await mkdir(directory, { recursive: true, mode: 0o700 });
const name = createHash("sha256").update(values.job).digest("hex");
const file = join(directory, `${name}.json`);
const lock = `${file}.lock`;
// One worker owns this job. After an actual process kill, inspect the saved phase and remove the
// stale lock only after establishing that its worker has stopped. Never clear another worker's lock.
await mkdir(lock);
const save = async (job) => {
	const pending = `${file}.pending`;
	await writeFile(pending, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
	await rename(pending, file);
};
try {
	let dropped = false;
	const quotum = createQuotum({
		baseUrl,
		apiKey,
		maxRetries: 0,
		fetch: async (url, init) => {
			const response = await fetch(url, init);
			const operation = url.endsWith("/reservations")
				? "reserve"
				: url.endsWith("/confirm")
					? "confirm"
					: url.endsWith("/release")
						? "release"
						: null;
			if (
				!dropped &&
				response.ok &&
				init.method === "POST" &&
				operation === values["drop-response"]
			) {
				dropped = true;
				await response.text();
				throw new Error("Simulated response loss after the server committed");
			}
			return response;
		},
	});
	const account = quotum.account(accountId);
	await account.create();
	const usage = entityId ? account.entity(entityId) : account;
	if (entityId) await usage.create({ kind: "workspace" });
	let job;
	try {
		job = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const identity = {
		jobId: values.job,
		accountId,
		entityId: entityId ?? null,
		scenario: values.scenario,
	};
	if (job && Object.keys(identity).some((key) => job[key] !== identity[key]))
		throw new Error("Job identity is already bound to other inputs");
	if (!job) {
		job = { ...identity, phase: "new", workRuns: 0 };
		await save(job);
	}
	if (job.phase === "running")
		throw new Error(
			"Work may have run without a recorded measurement. Reconcile it before confirming or releasing.",
		);
	if (job.phase === "new") {
		const hold = await usage.reserve({
			featureId: "model_tokens",
			value: values.scenario === "denied" ? "1000000000000" : "100",
			operationId: job.jobId,
			...(values.scenario === "expired" ? { expiresInSeconds: 1 } : {}),
		});
		if (hold.allowed) {
			job.phase = "reserved";
			job.reservationId = hold.reservationId;
		} else {
			job.phase = "denied";
			job.outcome = hold;
		}
		await save(job);
	}
	if (job.phase === "reserved") {
		if (values.scenario === "expired") await new Promise((resolve) => setTimeout(resolve, 1100));
		const hold = await usage.getReservation(job.reservationId);
		if (hold.status !== "active" || Date.parse(hold.expiresAt) <= Date.now()) {
			job.phase = hold.status === "expired" ? "expired" : "needs_reconciliation";
			await save(job);
		} else {
			job.phase = "running";
			await save(job);
			// Replace only this deterministic job with your AI provider. Include every billable token
			// in the reserved upper bound. Persist measured usage before attempting confirmation.
			job.workRuns++;
			job.actualValue = values.scenario === "zero" ? "0" : "60";
			job.phase = "measured";
			await save(job);
			if (values["crash-after-work"])
				throw new Error(
					"Stopped after persisting measured usage; rerun this job without --crash-after-work",
				);
		}
	}
	if (job.phase === "measured") {
		// A failed/ambiguous confirmation leaves the measurement in place. On restart repeat only
		// this phase with the same identity. Never release a hold just because confirmation failed.
		job.outcome =
			job.actualValue === "0"
				? await usage.release({ reservationId: job.reservationId, operationId: job.jobId })
				: await usage.confirm({
						reservationId: job.reservationId,
						value: job.actualValue,
						operationId: job.jobId,
					});
		job.phase =
			job.actualValue !== "0" && job.outcome.status !== "confirmed"
				? "needs_reconciliation"
				: job.outcome.status;
		await save(job);
	}
	process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
} finally {
	await rm(lock, { recursive: true });
}
