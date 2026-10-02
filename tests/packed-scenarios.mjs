export async function exercise(createQuotum, QuotumAmbiguousOperationError) {
	let assertions = 0;
	const assert = (condition, message) => {
		assertions++;
		if (!condition) throw new Error(message);
	};
	const outcome = {
		featureId: "credits",
		entityId: "child",
		operation: "consume",
		operationId: "job/packed",
		usage: { featureId: "credits", unit: "credit", value: "1" },
		rated: { featureId: "credits", unit: "credit", value: "1" },
		balance: {
			featureId: "credits",
			unit: "credit",
			granted: "5",
			consumed: "1",
			held: "0",
			available: "4",
		},
		allowed: true,
		receiptId: "ur_test",
		usageEventId: "1",
		recordedAt: "2026-10-02T12:00:00.000Z",
	};
	const ok = (data) => Response.json({ success: true, data });
	const calls = [];
	const quotum = createQuotum({
		baseUrl: "https://example.test",
		apiKey: "fake-test-key",
		maxRetries: 0,
		fetch: async (url, init) => {
			calls.push({ url, init });
			if (url.endsWith("/usage/consume")) {
				assert(
					init.body === JSON.stringify({ featureId: "credits", value: "1", entityId: "child" }),
					"canonical body",
				);
				assert(
					new Headers(init.headers).get("idempotency-key") === "job/packed",
					"caller operation key",
				);
				throw new Error("response lost after commit");
			}
			return ok({
				operation: "consume",
				operationId: "job/packed",
				status: "completed",
				completedAt: outcome.recordedAt,
				outcome,
			});
		},
	});
	const account = quotum.account("payer/a");
	const entity = account.entity("child");
	assert(calls.length === 0 && Object.isFrozen(entity), "zero I/O immutable handles");
	const { consume } = entity;
	const result = await consume({
		featureId: "credits",
		value: "0001.000",
		operationId: "job/packed",
	});
	assert(JSON.stringify(result) === JSON.stringify(outcome), "lookup recovers original outcome");
	assert(
		calls.length === 2 && calls[1].url.includes("job%2Fpacked?entityId=child"),
		"scoped recovery route",
	);
	assert(
		calls[0].url.includes("payer%2Fa") && calls[0].init.redirect === "error",
		"encoded identity and credential-safe redirects",
	);
	const before = calls.length;
	for (const value of [0, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
		try {
			await consume({ featureId: "credits", value, operationId: "invalid" });
			throw new Error("expected input refusal");
		} catch (error) {
			assert(error.code === "INVALID_REQUEST", "unsafe number refused");
		}
	}
	assert(calls.length === before, "invalid input dispatches nothing");
	const controller = new AbortController();
	controller.abort();
	try {
		await consume(
			{ featureId: "credits", value: 1n, operationId: "aborted" },
			{ signal: controller.signal },
		);
		throw new Error("expected abort");
	} catch (error) {
		assert(error.code === "REQUEST_ABORTED", "pre-dispatch abort");
	}
	const ambiguous = createQuotum({
		baseUrl: "https://example.test",
		apiKey: "fake-test-key",
		maxRetries: 0,
		fetch: async (_, init) => {
			if (init.method === "POST") throw new Error("lost");
			return Response.json(
				{ success: false, error: { code: "OPERATION_NOT_FOUND", message: "Absent" } },
				{ status: 404 },
			);
		},
	});
	try {
		await ambiguous
			.account("payer")
			.consume({ featureId: "credits", value: 1, operationId: "uncertain" });
		throw new Error("expected ambiguity");
	} catch (error) {
		assert(
			error instanceof QuotumAmbiguousOperationError && error.latestState === "not_found",
			"absence is not rollback",
		);
	}
	const timed = createQuotum({
		baseUrl: "https://example.test",
		apiKey: "fake-test-key",
		timeoutMs: 10,
		fetch: async () => new Promise(() => {}),
	});
	try {
		await timed.account("payer").get();
		throw new Error("expected deadline");
	} catch (error) {
		assert(error.code === "REQUEST_TIMEOUT", "deadline bounds an ignoring fetch");
	}
	let retryCalls = 0;
	const retried = createQuotum({
		baseUrl: "https://example.test",
		apiKey: "fake-test-key",
		maxRetries: 1,
		fetch: async () => {
			retryCalls++;
			if (retryCalls === 1) return new Response("temporarily unavailable", { status: 503 });
			return ok({ id: "payer", createdAt: "2026-10-01T00:00:00.000Z" });
		},
	});
	assert(
		(await retried.account("payer").get()).id === "payer" && retryCalls === 2,
		"bounded transient retry",
	);
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async function () {
			assert(this === globalThis, "global fetch retains its receiver");
			return ok({ id: "payer", createdAt: "2026-10-01T00:00:00.000Z" });
		};
		const standard = createQuotum({ baseUrl: "https://example.test", apiKey: "fake-test-key" });
		assert((await standard.account("payer").get()).id === "payer", "global fetch path");
	} finally {
		globalThis.fetch = originalFetch;
	}
	Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
	try {
		try {
			createQuotum({ baseUrl: "https://example.test", apiKey: "fake-test-key" });
			throw new Error("expected browser refusal");
		} catch (error) {
			assert(error.code === "UNSUPPORTED_RUNTIME", "DOM browser refusal");
		}
	} finally {
		Reflect.deleteProperty(globalThis, "document");
	}
	return { assertions };
}
