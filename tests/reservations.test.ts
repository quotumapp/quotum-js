import { describe, expect, it } from "bun:test";
import type { Fetch, Reservation, UsageOutcomes } from "../src/index.js";
import { createQuotum, QuotumAmbiguousOperationError } from "../src/index.js";

const time = "2026-10-02T12:00:00.000Z";
const scope = { featureId: "tokens", entityId: null };
const context = {
	...scope,
	usage: { featureId: "tokens", unit: "token", value: "100" },
	rated: { featureId: "credits", unit: "credit", value: "0.5" },
	balance: {
		featureId: "credits",
		unit: "credit",
		granted: "10",
		consumed: "0",
		held: "0.5",
		available: "9.5",
	},
};
const state: Reservation = {
	...scope,
	billingAccountId: "payer",
	reservationId: "hold",
	usage: context.usage,
	status: "active",
	confirmedValue: null,
	receiptId: null,
	createdAt: time,
	expiresAt: time,
	finalizedAt: null,
};
const outcomes = {
	reserve: {
		...context,
		operation: "reserve",
		operationId: "job",
		allowed: true,
		reservationId: "hold",
		status: "active",
		expiresAt: time,
	},
	confirm: {
		...context,
		operation: "confirm",
		operationId: "job",
		allowed: true,
		reservationId: "hold",
		status: "confirmed",
		receiptId: "ur_receipt",
		usageEventId: "event",
		recordedAt: time,
	},
	release: {
		...scope,
		operation: "release",
		operationId: "job",
		reservationId: "hold",
		status: "released",
		finalizedAt: time,
	},
} as const satisfies Pick<UsageOutcomes, "reserve" | "confirm" | "release">;
const ok = (data: unknown) => Response.json({ success: true, data });
const error = (code: string, status = 409) =>
	Response.json({ success: false, error: { code, message: code } }, { status });
const client = (fetch: Fetch, options: object = {}) =>
	createQuotum({
		baseUrl: "https://billing.test",
		apiKey: "test",
		maxRetries: 0,
		fetch,
		...options,
	}).account("payer");
const reserve = { featureId: "tokens", value: "100", operationId: "job" };
const finalize = { reservationId: "hold", operationId: "job" };

describe("reservations and recovery", () => {
	it("normalizes upper bounds and TTL, keeps methods bound and exposes current reservation state", async () => {
		const calls: RequestInit[] = [];
		const account = client(async (_, init) => {
			calls.push(init);
			return ok(init.method === "POST" ? outcomes.reserve : state);
		});
		const { reserve: bound } = account;
		expect(await bound({ ...reserve, value: "00100.000", expiresInSeconds: 600 })).toEqual(
			outcomes.reserve,
		);
		expect(JSON.parse(String(calls[0]?.body))).toEqual({
			featureId: "tokens",
			value: "100",
			expiresInSeconds: 600,
		});
		expect(new Headers(calls[0]?.headers).get("idempotency-key")).toBe("job");
		expect(await account.getReservation("hold")).toEqual(state);
	});

	it("rejects invalid reservation inputs before any network request", async () => {
		let calls = 0;
		const account = client(async () => {
			calls++;
			return ok({});
		});
		for (const expiresInSeconds of [0, -1, 1.5, 86401, Number.NaN])
			await expect(account.reserve({ ...reserve, expiresInSeconds })).rejects.toMatchObject({
				code: "INVALID_REQUEST",
			});
		for (const value of [0, -1, 0.5, "1e2", " 1", "0"])
			await expect(account.confirm({ ...finalize, value })).rejects.toMatchObject({
				code: "INVALID_REQUEST",
			});
		await expect(
			account.release({ ...finalize, entityId: "other" } as typeof finalize),
		).rejects.toMatchObject({ code: "INVALID_REQUEST" });
		expect(calls).toBe(0);
	});

	it("checks exact immutable entity scope before finalizing and never submits a mismatched mutation", async () => {
		let writes = 0;
		const fetch: Fetch = async (_, init) => {
			if (init.method === "POST") writes++;
			return ok({ ...state, entityId: "child" });
		};
		await expect(client(fetch).confirm({ ...finalize, value: 10 })).rejects.toMatchObject({
			code: "RESERVATION_NOT_FOUND",
		});
		await expect(client(fetch).release(finalize)).rejects.toMatchObject({
			code: "RESERVATION_NOT_FOUND",
		});
		expect(writes).toBe(0);
	});

	for (const operation of ["reserve", "confirm", "release"] as const) {
		it(`recovers a committed ${operation} after response loss with the original operation kind and input`, async () => {
			const paths: string[] = [];
			const bodies: string[] = [];
			const account = client(async (url, init) => {
				paths.push(url);
				if (init.method === "POST") {
					bodies.push(String(init.body));
					expect(new Headers(init.headers).get("idempotency-key")).toBe("job");
					throw new Error("Response lost after commit");
				}
				if (url.includes("/operations/"))
					return ok({
						operation,
						operationId: "job",
						status: "completed",
						outcome: outcomes[operation],
						completedAt: time,
					});
				return ok(state);
			});
			const result =
				operation === "reserve"
					? await account.reserve(reserve)
					: operation === "confirm"
						? await account.confirm({ ...finalize, value: 100 })
						: await account.release(finalize);
			expect(result).toEqual(outcomes[operation]);
			expect(paths.at(-1)).toEndWith(`/usage/operations/${operation}/job`);
			expect(bodies).toHaveLength(1);
		});
	}

	it("returns expected denial, expiry and terminal release outcomes without conflating errors", async () => {
		expect(
			await client(async () =>
				ok({
					...context,
					operation: "reserve",
					operationId: "job",
					allowed: false,
					reason: "insufficient_balance",
				}),
			).reserve(reserve),
		).toMatchObject({ allowed: false });
		const expired = {
			...context,
			operation: "confirm",
			operationId: "job",
			reservationId: "hold",
			status: "expired",
			allowed: false,
			reason: "reservation_expired",
		} as const;
		const account = client(async (_, init) => ok(init.method === "GET" ? state : expired));
		expect(await account.confirm({ ...finalize, value: 100 })).toEqual(expired);
		await expect(
			client(async (_, init) =>
				init.method === "GET" ? ok(state) : error("RESERVATION_RELEASED"),
			).confirm({ ...finalize, value: 100 }),
		).rejects.toMatchObject({ code: "RESERVATION_RELEASED", retryable: false });
		expect(
			await client(async (_, init) =>
				ok(init.method === "GET" ? state : { ...outcomes.release, status: "confirmed" }),
			).release(finalize),
		).toMatchObject({ status: "confirmed" });
	});

	it("keeps missing, processing and expired recovery outcomes ambiguous without releasing used work", async () => {
		for (const latest of ["not_found", "processing", "result_expired"] as const) {
			const account = client(async (url, init) => {
				if (init.method === "POST") throw new Error("lost confirmation");
				if (!url.includes("/operations/")) return ok(state);
				return latest === "processing"
					? ok({
							operation: "confirm",
							operationId: "job",
							status: "processing",
							outcome: null,
							completedAt: null,
						})
					: error(
							latest === "not_found" ? "OPERATION_NOT_FOUND" : "OPERATION_RESULT_EXPIRED",
							latest === "not_found" ? 404 : 409,
						);
			});
			await expect(account.confirm({ ...finalize, value: 100 })).rejects.toMatchObject({
				code: "AMBIGUOUS_OPERATION",
				operation: "confirm",
				operationId: "job",
				latestState: latest,
			});
		}
	});

	it("uses one total deadline and retry budget for the scope read and finalization", async () => {
		let calls = 0;
		const account = client(
			async () => {
				calls++;
				return new Promise<Response>(() => {});
			},
			{ timeoutMs: 20 },
		);
		await expect(account.release(finalize)).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
		expect(calls).toBe(1);
		let reads = 0;
		let writes = 0;
		const retrying = client(
			async (url, init) => {
				if (init.method === "POST") {
					writes++;
					return error("INTERNAL_ERROR", 500);
				}
				if (url.includes("/operations/")) return error("OPERATION_NOT_FOUND", 404);
				return ++reads === 1 ? error("TEMPORARY", 503) : ok(state);
			},
			{ maxRetries: 2 },
		);
		await expect(retrying.release(finalize)).rejects.toBeInstanceOf(QuotumAmbiguousOperationError);
		expect(reads).toBe(2);
		expect(writes).toBe(2);
	});

	it("recovers every operation through the public lookup and validates the exact result kind", async () => {
		for (const operation of ["reserve", "confirm", "release"] as const) {
			const account = client(async () =>
				ok({
					operation,
					operationId: "job",
					status: "completed",
					completedAt: time,
					outcome: outcomes[operation],
				}),
			);
			expect((await account.getOperation({ operation, operationId: "job" })).outcome).toEqual(
				outcomes[operation],
			);
		}
		await expect(
			client(async () =>
				ok({
					operation: "confirm",
					operationId: "job",
					status: "completed",
					completedAt: time,
					outcome: outcomes.release,
				}),
			).getOperation({ operation: "confirm", operationId: "job" }),
		).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
	});
});
