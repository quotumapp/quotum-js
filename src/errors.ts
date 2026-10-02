export interface QuotumErrorOptions {
	status?: number;
	requestId?: string;
	retryable?: boolean;
	retryAfterMs?: number;
}

export class QuotumError extends Error {
	readonly status: number | null;
	readonly requestId: string | null;
	readonly retryable: boolean;
	readonly retryAfterMs: number | null;
	constructor(
		readonly code: string,
		message: string,
		options: QuotumErrorOptions = {},
	) {
		super(message);
		this.name = new.target.name;
		this.status = options.status ?? null;
		this.requestId = options.requestId ?? null;
		this.retryable = options.retryable ?? false;
		this.retryAfterMs = options.retryAfterMs ?? null;
	}
}

export interface OperationIdentity {
	billingAccountId: string;
	entityId: string | null;
	operation: "consume";
	operationId: string;
}

export class QuotumAmbiguousOperationError extends QuotumError {
	readonly billingAccountId: string;
	readonly entityId: string | null;
	readonly operation: "consume";
	readonly operationId: string;
	readonly latestState: "unknown" | "processing" | "not_found" | "result_expired";
	constructor(
		identity: OperationIdentity,
		latestState: QuotumAmbiguousOperationError["latestState"],
		options: QuotumErrorOptions = {},
	) {
		super(
			"AMBIGUOUS_OPERATION",
			"The usage outcome is unresolved. Recover using the same account, scope and operationId.",
			options,
		);
		this.billingAccountId = identity.billingAccountId;
		this.entityId = identity.entityId;
		this.operation = identity.operation;
		this.operationId = identity.operationId;
		this.latestState = latestState;
	}
}

export function invalid(message: string): never {
	throw new QuotumError("INVALID_REQUEST", message);
}
