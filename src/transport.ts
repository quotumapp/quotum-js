import {
	invalid,
	type OperationIdentity,
	QuotumAmbiguousOperationError,
	QuotumError,
} from "./errors.js";
import type { Fetch, QuotumOptions, RequestOptions } from "./types.js";
import { consumeResult, identifier, object, protocol, segment, timestamp } from "./validation.js";

interface RequestSpec<T> {
	method?: "GET" | "POST" | "PUT";
	path: string;
	body?: object;
	validate: (value: unknown) => T;
	operation?: OperationIdentity & { featureId: string };
}

function retries(value: number): number {
	if (!Number.isInteger(value) || value < 0 || value > 2) invalid("maxRetries must be 0, 1 or 2");
	return value;
}
function timeout(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)
		invalid("timeoutMs must be a positive integer below 2147483648");
	return value;
}
function retryable(status: number, code: string): boolean {
	if (
		code.includes("NOT_CONFIGURED") ||
		code === "INVALID_REQUEST" ||
		code === "UNAUTHORIZED" ||
		code === "READ_ONLY_CREDENTIAL"
	)
		return false;
	return (
		status === 408 ||
		status === 429 ||
		[500, 502, 503, 504].includes(status) ||
		code === "OPERATION_IN_PROGRESS"
	);
}
function retryDelay(response: Response): number | undefined {
	const value = response.headers.get("retry-after");
	if (value === null) return undefined;
	const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
	const delay = seconds === undefined ? Date.parse(value) - Date.now() : seconds * 1000;
	return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}
async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	const decoder = new TextDecoder();
	let size = 0;
	let text = "";
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > 262_144) {
				void reader.cancel().catch(() => {});
				protocol();
			}
			text += decoder.decode(part.value, { stream: true });
		}
		text += decoder.decode();
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	} finally {
		signal.removeEventListener("abort", abort);
		reader.releaseLock();
	}
}

export class Transport {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly fetcher: Fetch;
	private readonly timeoutMs: number;
	private readonly maxRetries: number;
	constructor(options: QuotumOptions) {
		if (typeof document !== "undefined")
			throw new QuotumError(
				"UNSUPPORTED_RUNTIME",
				"Use Quotum API credentials only in a trusted backend",
			);
		if (!object(options)) invalid("Client options are required");
		let url: URL;
		try {
			url = new URL(options.baseUrl);
		} catch {
			invalid("baseUrl must be an absolute HTTP(S) URL");
		}
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			invalid("baseUrl must be HTTP(S), without credentials, query or fragment");
		this.baseUrl = url.href.replace(/\/+$/, "");
		this.apiKey = identifier(options.apiKey, "apiKey", 4096);
		if (!/^[\x21-\x7e]+$/u.test(this.apiKey))
			invalid("apiKey must contain printable ASCII without spaces");
		this.timeoutMs = timeout(options.timeoutMs ?? 10_000);
		this.maxRetries = retries(options.maxRetries ?? 2);
		this.fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
		if (typeof this.fetcher !== "function") invalid("A fetch implementation is required");
	}

	async send<T>(spec: RequestSpec<T>, options: RequestOptions = {}): Promise<T> {
		const deadlineMs = timeout(options.timeoutMs ?? this.timeoutMs);
		const maxRetries = retries(options.maxRetries ?? this.maxRetries);
		const headers = new Headers({
			authorization: `Bearer ${this.apiKey}`,
			accept: "application/json",
		});
		if (options.requestId !== undefined) {
			const id = identifier(options.requestId, "requestId", 128);
			if (!/^[A-Za-z0-9._:-]+$/u.test(id))
				invalid("requestId accepts letters, digits, dots, underscores, colons and hyphens");
			headers.set("x-request-id", id);
		}
		if (spec.operation) headers.set("idempotency-key", spec.operation.operationId);
		let body: string | undefined;
		try {
			body = spec.body === undefined ? undefined : JSON.stringify(spec.body);
		} catch {
			invalid("Request body must be JSON serializable");
		}
		if (body !== undefined) headers.set("content-type", "application/json");
		const controller = new AbortController();
		let timedOut = false;
		let uncertain = false;
		let inFlightMutation = false;
		let requestId = options.requestId;
		let latestState: QuotumAmbiguousOperationError["latestState"] = "unknown";
		const aborted = () =>
			new QuotumError(
				timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED",
				timedOut ? "The total request deadline elapsed" : "The request was aborted",
				requestId ? { requestId } : {},
			);
		const ensureActive = () => {
			if (controller.signal.aborted) throw aborted();
		};
		const onCallerAbort = () => controller.abort();
		if (options.signal?.aborted) throw aborted();
		options.signal?.addEventListener("abort", onCallerAbort, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, deadlineMs);
		let onAbort: () => void = () => {};
		const abortPromise = new Promise<never>((_, reject) => {
			onAbort = () => reject(aborted());
			controller.signal.addEventListener("abort", onAbort, { once: true });
		});
		const pause = async (milliseconds: number) => {
			ensureActive();
			await new Promise<void>((resolve, reject) => {
				const cleanup = () => controller.signal.removeEventListener("abort", stop);
				const stop = () => {
					clearTimeout(wait);
					cleanup();
					reject(aborted());
				};
				const wait = setTimeout(
					() => {
						cleanup();
						resolve();
					},
					Math.min(milliseconds, 2_147_483_647),
				);
				controller.signal.addEventListener("abort", stop, { once: true });
			});
		};
		const once = async (path: string, method: string, data?: string): Promise<unknown> => {
			ensureActive();
			const callHeaders = new Headers(headers);
			if (method === "GET") {
				callHeaders.delete("content-type");
				callHeaders.delete("idempotency-key");
			}
			let response: Response;
			try {
				response = await this.fetcher(`${this.baseUrl}${path}`, {
					method,
					headers: callHeaders,
					redirect: "error",
					signal: controller.signal,
					...(data === undefined ? {} : { body: data }),
				});
			} catch {
				ensureActive();
				throw new QuotumError(
					"NETWORK_ERROR",
					"The request failed before a response was received",
					{ retryable: true },
				);
			}
			requestId = response.headers.get("x-request-id") ?? requestId;
			let payload: unknown;
			try {
				payload = await readBody(response, controller.signal);
			} catch (error) {
				if (error instanceof QuotumError) throw error;
				ensureActive();
				throw new QuotumError("NETWORK_ERROR", "The response body could not be read", {
					retryable: true,
					status: response.status,
					...(requestId ? { requestId } : {}),
				});
			}
			if (!response.ok) {
				const envelope = object(payload) && object(payload.error) ? payload.error : {};
				const code =
					typeof envelope.code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(envelope.code)
						? envelope.code
						: "HTTP_ERROR";
				const message =
					typeof envelope.message === "string"
						? envelope.message.slice(0, 1000).split(this.apiKey).join("[redacted]")
						: `Quotum returned HTTP ${response.status}`;
				requestId = typeof envelope.requestId === "string" ? envelope.requestId : requestId;
				const delay = retryDelay(response);
				throw new QuotumError(code, message, {
					status: response.status,
					retryable: retryable(response.status, code),
					...(requestId ? { requestId } : {}),
					...(delay === undefined ? {} : { retryAfterMs: delay }),
				});
			}
			if (!object(payload) || payload.success !== true || !Object.hasOwn(payload, "data"))
				protocol();
			return payload.data;
		};
		const run = async (): Promise<T> => {
			let failure: QuotumError | undefined;
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				ensureActive();
				inFlightMutation = spec.operation !== undefined;
				try {
					const value = await once(spec.path, spec.method ?? "GET", body);
					const result = spec.validate(value);
					uncertain = false;
					return result;
				} catch (error) {
					failure =
						error instanceof QuotumError
							? error
							: new QuotumError("PROTOCOL_ERROR", "Quotum returned an invalid response");
					if (
						spec.operation &&
						([
							"NETWORK_ERROR",
							"PROTOCOL_ERROR",
							"OPERATION_IN_PROGRESS",
							"REQUEST_ABORTED",
							"REQUEST_TIMEOUT",
						].includes(failure.code) ||
							failure.status === 408 ||
							(failure.status ?? 0) >= 500)
					)
						uncertain = true;
				} finally {
					inFlightMutation = false;
				}
				ensureActive();
				if (
					failure.code === "OPERATION_IN_PROGRESS" ||
					!failure.retryable ||
					attempt === maxRetries
				)
					break;
				await pause(
					Math.max(failure.retryAfterMs ?? 0, 250 * 2 ** attempt * (0.5 + Math.random())),
				);
			}
			if (spec.operation && uncertain) {
				ensureActive();
				const identity = spec.operation;
				const query =
					identity.entityId === null ? "" : `?entityId=${encodeURIComponent(identity.entityId)}`;
				try {
					const value = await once(
						`/v1/billing-accounts/${segment(identity.billingAccountId)}/usage/operations/consume/${segment(identity.operationId)}${query}`,
						"GET",
					);
					if (
						!object(value) ||
						value.operation !== "consume" ||
						value.operationId !== identity.operationId
					)
						protocol();
					if (value.status === "completed") {
						if (!timestamp(value.completedAt)) protocol();
						const result = consumeResult(
							value.outcome,
							identity.operationId,
							identity.entityId,
							identity.featureId,
						);
						uncertain = false;
						return spec.validate(result);
					}
					if (value.status !== "processing" || value.outcome !== null || value.completedAt !== null)
						protocol();
					latestState = "processing";
				} catch (error) {
					if (error instanceof QuotumError && error.code === "OPERATION_NOT_FOUND")
						latestState = "not_found";
					if (error instanceof QuotumError && error.code === "OPERATION_RESULT_EXPIRED")
						latestState = "result_expired";
				}
				throw new QuotumAmbiguousOperationError(
					identity,
					latestState,
					requestId ? { requestId } : {},
				);
			}
			throw failure;
		};
		try {
			return await Promise.race([run(), abortPromise]);
		} catch (error) {
			if (error instanceof QuotumAmbiguousOperationError) throw error;
			if (spec.operation && (uncertain || inFlightMutation))
				throw new QuotumAmbiguousOperationError(
					spec.operation,
					latestState,
					requestId ? { requestId } : {},
				);
			throw error;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onCallerAbort);
			controller.signal.removeEventListener("abort", onAbort);
		}
	}
}
