import { afterEach, describe, expect, it } from "bun:test";
import type { ConsumeResult, Fetch } from "../src/index.js";
import { createQuotum, QuotumAmbiguousOperationError, QuotumError } from "../src/index.js";

const baseUrl = "https://billing.example.test";
const scope = { featureId: "tokens", entityId: null };
const context = {
	...scope,
	usage: { featureId: "tokens", unit: "token", value: "1" },
	rated: { featureId: "credits", unit: "credit", value: "0.5" },
	balance: {
		featureId: "credits",
		unit: "credit",
		granted: "10",
		consumed: "0.5",
		held: "0",
		available: "9.5",
	},
};
const result: ConsumeResult = {
	...context,
	operation: "consume",
	operationId: "job/1",
	allowed: true,
	receiptId: "ur_receipt",
	recordedAt: "2026-10-02T12:00:00.000Z",
};
const ok = (data: unknown) =>
	Response.json({ success: true, data }, { headers: { "x-request-id": "request-server" } });
const failure = (status: number, code: string, headers: HeadersInit = {}) =>
	Response.json(
		{ success: false, error: { code, message: "Request failed" } },
		{ status, headers },
	);
const lookup = () =>
	ok({
		operation: "consume",
		operationId: "job/1",
		status: "completed",
		completedAt: result.recordedAt,
		outcome: result,
	});
const input = { featureId: "tokens", value: 1, operationId: "job/1" };
const client = (fetch: Fetch, extra: object = {}) =>
	createQuotum({ baseUrl, apiKey: "test-key", fetch, maxRetries: 0, ...extra });
afterEach(() => {
	Reflect.deleteProperty(globalThis, "document");
});

describe("public handles and validation", () => {
	it("constructs immutable zero-I/O handles with bound methods and encoded scopes", async () => {
		const calls: Array<[string, RequestInit]> = [];
		const quotum = client(async (url, init) => {
			calls.push([url, init]);
			return ok({
				...context,
				entityId: "workspace/a",
				kind: "metered",
				checkedAt: result.recordedAt,
				allowed: true,
			});
		});
		const account = quotum.account("payer/a");
		const entity = account.entity("workspace/a");
		expect(calls).toHaveLength(0);
		expect([quotum, account, entity].every(Object.isFrozen)).toBe(true);
		const { check } = entity;
		await check({ featureId: "tokens", value: 1n });
		expect(calls[0]?.[0]).toBe(`${baseUrl}/v1/billing-accounts/payer%2Fa/usage/check`);
		expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({
			featureId: "tokens",
			value: "1",
			entityId: "workspace/a",
		});
		expect(new Headers(calls[0]?.[1].headers).get("authorization")).toBe("Bearer test-key");
		expect(calls[0]?.[1].redirect).toBe("error");
	});
	it("canonicalizes exact values once and never puts the operation key in the body", async () => {
		const bodies: string[] = [];
		const account = client(async (_, init) => {
			bodies.push(String(init.body));
			expect(new Headers(init.headers).get("idempotency-key")).toBe(input.operationId);
			return ok(result);
		}).account("payer");
		for (const value of [1, 1n, "1.000", "0001.000"]) await account.consume({ ...input, value });
		expect(new Set(bodies).size).toBe(1);
		expect(JSON.parse(bodies[0] ?? "")).toEqual({ featureId: "tokens", value: "1" });
	});
	it("rejects unsafe input before dispatch", async () => {
		let calls = 0;
		const account = client(async () => {
			calls++;
			return ok(result);
		}).account("payer");
		for (const value of [
			0,
			-1,
			1.5,
			Number.MAX_SAFE_INTEGER + 1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			"0",
			"000.000",
			"1e3",
			" 1",
			"-1",
			"0.0000000001",
			"10000000000000000000",
		])
			await expect(account.consume({ ...input, value })).rejects.toMatchObject({
				code: "INVALID_REQUEST",
			});
		await expect(account.consume({ ...input, metadata: {} } as typeof input)).rejects.toMatchObject(
			{ code: "INVALID_REQUEST" },
		);
		await expect(account.consume({ ...input, operationId: "" })).rejects.toMatchObject({
			code: "INVALID_REQUEST",
		});
		expect(calls).toBe(0);
	});
	it("rejects DOM browsers and unsafe credential destinations", () => {
		Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
		expect(() => createQuotum({ baseUrl, apiKey: "test" })).toThrow("trusted backend");
		Reflect.deleteProperty(globalThis, "document");
		for (const url of [
			"ftp://host",
			"https://user:password@host",
			"https://host?token=secret",
			"bad",
		])
			expect(() => createQuotum({ baseUrl: url, apiKey: "test" })).toThrow(QuotumError);
	});
	it("returns business denials as data and rejects malformed successful results", async () => {
		const denied: ConsumeResult = {
			...context,
			operation: "consume",
			operationId: input.operationId,
			allowed: false,
			reason: "insufficient_balance",
		};
		expect(
			await client(async () => ok(denied))
				.account("payer")
				.consume(input),
		).toEqual(denied);
		await expect(
			client(async () => ok({ allowed: true }))
				.account("payer")
				.check({ featureId: "tokens", value: 1 }),
		).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
	});
	it("supports boolean checks and entity CRUD without adding usage fields", async () => {
		const entity = client(async (_, init) => {
			if (String(init.body).includes("featureId"))
				return ok({
					...scope,
					entityId: "child",
					kind: "boolean",
					checkedAt: result.recordedAt,
					allowed: false,
					reason: "not_entitled",
				});
			return ok({
				id: "123",
				externalId: "child",
				kind: "workspace",
				metadata: {},
				createdAt: result.recordedAt,
				updatedAt: result.recordedAt,
			});
		})
			.account("payer")
			.entity("child");
		expect(await entity.create({ kind: "workspace" })).toMatchObject({ externalId: "child" });
		expect(await entity.get()).toMatchObject({ externalId: "child" });
		expect(await entity.check({ featureId: "tokens" })).toMatchObject({
			allowed: false,
			kind: "boolean",
		});
	});
});

describe("transport and recovery", () => {
	it("recovers a lost response using the same canonical body/key and then lookup", async () => {
		const calls: Array<[string, RequestInit]> = [];
		const account = client(
			async (url, init) => {
				calls.push([url, init]);
				if (init.method === "POST") throw new Error("connection dropped after commit");
				return lookup();
			},
			{ maxRetries: 2 },
		).account("payer");
		expect(await account.consume({ ...input, value: "1.000" })).toEqual(result);
		expect(calls).toHaveLength(4);
		expect(new Set(calls.slice(0, 3).map(([, init]) => init.body)).size).toBe(1);
		for (const [, init] of calls.slice(0, 3))
			expect(new Headers(init.headers).get("idempotency-key")).toBe("job/1");
		expect(calls[3]?.[0]).toEndWith("/usage/operations/consume/job%2F1");
		expect(new Headers(calls[3]?.[1].headers).has("idempotency-key")).toBe(false);
	});
	it("reports a scoped ambiguity when absence does not establish rollback", async () => {
		let calls = 0;
		const entity = client(async (url) => {
			calls++;
			if (calls === 1) throw new Error("lost");
			expect(url).toEndWith("?entityId=child");
			return failure(404, "OPERATION_NOT_FOUND", { "x-request-id": "last-request" });
		})
			.account("payer")
			.entity("child");
		await expect(entity.consume(input)).rejects.toMatchObject({
			name: "QuotumAmbiguousOperationError",
			code: "AMBIGUOUS_OPERATION",
			billingAccountId: "payer",
			entityId: "child",
			operationId: input.operationId,
			latestState: "not_found",
			requestId: "last-request",
		});
		expect(calls).toBe(2);
	});
	it("recovers in-progress operations without changing their identity", async () => {
		let calls = 0;
		const account = client(async () =>
			++calls === 1 ? failure(409, "OPERATION_IN_PROGRESS") : lookup(),
		).account("payer");
		expect(await account.consume(input)).toEqual(result);
		expect(calls).toBe(2);
	});
	it("does not retry auth, configuration, validation or idempotency conflicts", async () => {
		for (const [status, code] of [
			[401, "UNAUTHORIZED"],
			[409, "USAGE_NOT_CONFIGURED"],
			[400, "INVALID_REQUEST"],
			[409, "IDEMPOTENCY_CONFLICT"],
		] as const) {
			let calls = 0;
			const account = client(
				async () => {
					calls++;
					return failure(status, code, { "x-request-id": "failed-request" });
				},
				{ maxRetries: 2 },
			).account("payer");
			await expect(account.consume(input)).rejects.toMatchObject({
				code,
				status,
				retryable: false,
				requestId: "failed-request",
			});
			expect(calls).toBe(1);
		}
	});
	it("keeps HTTP status and request ID for non-JSON errors", async () => {
		const account = client(
			async () =>
				new Response("upstream error", { status: 502, headers: { "x-request-id": "edge" } }),
		).account("payer");
		await expect(account.get()).rejects.toMatchObject({
			code: "HTTP_ERROR",
			status: 502,
			requestId: "edge",
			retryable: true,
		});
	});
	it("includes Retry-After waiting in one deadline and stops before another dispatch", async () => {
		let calls = 0;
		const account = client(
			async () => {
				calls++;
				return failure(429, "RATE_LIMITED", { "retry-after": "60" });
			},
			{ maxRetries: 2, timeoutMs: 30 },
		).account("payer");
		await expect(account.get()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
		expect(calls).toBe(1);
	});
	it("distinguishes pre-dispatch cancellation from an unknown post-dispatch outcome", async () => {
		let calls = 0;
		const before = new AbortController();
		before.abort();
		const account = client(async () => {
			calls++;
			return ok(result);
		}).account("payer");
		await expect(account.consume(input, { signal: before.signal })).rejects.toMatchObject({
			code: "REQUEST_ABORTED",
		});
		expect(calls).toBe(0);
		const after = new AbortController();
		const interrupted = client(async () => {
			calls++;
			after.abort();
			return new Promise<Response>(() => {});
		}).account("payer");
		await expect(interrupted.consume(input, { signal: after.signal })).rejects.toBeInstanceOf(
			QuotumAmbiguousOperationError,
		);
		expect(calls).toBe(1);
	});
	it("enforces a total deadline even when fetch or a body stream ignores abort", async () => {
		const start = Date.now();
		await expect(
			client(async () => new Promise<Response>(() => {}), { timeoutMs: 25 })
				.account("payer")
				.consume(input),
		).rejects.toBeInstanceOf(QuotumAmbiguousOperationError);
		await expect(
			client(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 25 })
				.account("payer")
				.get(),
		).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
		expect(Date.now() - start).toBeLessThan(1000);
	});
	it("refuses a recovered result from a different operation or entity", async () => {
		const account = client(async (_, init) => {
			if (init.method === "POST") throw new Error("lost");
			return ok({
				operation: "consume",
				operationId: "job/1",
				status: "completed",
				outcome: { ...result, entityId: "another" },
				completedAt: result.recordedAt,
			});
		}).account("payer");
		await expect(account.consume(input)).rejects.toMatchObject({ code: "AMBIGUOUS_OPERATION" });
	});
});
