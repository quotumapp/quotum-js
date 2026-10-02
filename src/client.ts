import { invalid } from "./errors.js";
import { Transport } from "./transport.js";
import type {
	AccountHandle,
	BillingAccount,
	CheckInput,
	CheckResult,
	ConsumeInput,
	Entity,
	EntityHandle,
	GetOperationInput,
	OperationResult,
	Quotum,
	QuotumOptions,
	ReceiptDeductionPage,
	ReceiptDeductionsInput,
	RequestOptions,
	UsageHandle,
	UsageReceipt,
} from "./types.js";
import {
	consumeResult,
	decimal,
	identifier,
	knownKeys,
	metered,
	nullableString,
	object,
	protocol,
	segment,
	string,
	timestamp,
	verdict,
} from "./validation.js";

function accountResult(value: unknown, id: string): BillingAccount {
	if (!object(value) || value.id !== id || !timestamp(value.createdAt)) protocol();
	return value as unknown as BillingAccount;
}
function entityResult(value: unknown, externalId: string): Entity {
	if (
		!object(value) ||
		!string(value.id) ||
		value.externalId !== externalId ||
		!string(value.kind) ||
		!object(value.metadata) ||
		!timestamp(value.createdAt) ||
		!timestamp(value.updatedAt)
	)
		protocol();
	return value as unknown as Entity;
}
function usageBody(input: CheckInput, entityId: string | null, consume = false) {
	knownKeys(
		input,
		consume
			? ["featureId", "value", "occurredAt", "operationId"]
			: ["featureId", "value", "occurredAt"],
	);
	const featureId = identifier(input.featureId, "featureId", 120);
	const value = input.value === undefined ? undefined : decimal(input.value);
	let occurredAt: string | undefined;
	if (input.occurredAt !== undefined) {
		if (
			typeof input.occurredAt !== "string" ||
			!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input.occurredAt) ||
			!timestamp(input.occurredAt)
		)
			invalid(
				"occurredAt must be an ISO date-time with a timezone and at most millisecond precision",
			);
		occurredAt = new Date(input.occurredAt).toISOString();
	}
	return {
		featureId,
		...(value === undefined ? {} : { value }),
		...(entityId === null ? {} : { entityId }),
		...(occurredAt === undefined ? {} : { occurredAt }),
	};
}
function operationId(value: unknown): string {
	const id = identifier(value, "operationId");
	if (!/^[\x20-\x7e]+$/u.test(id))
		invalid("operationId must contain printable ASCII for the Idempotency-Key header");
	return id;
}

/** Constructs a backend client. Creating clients or handles never performs I/O. */
export function createQuotum(options: QuotumOptions): Quotum {
	const transport = new Transport(options);
	const usage = (billingAccountId: string, entityId: string | null): UsageHandle => {
		const base = `/v1/billing-accounts/${segment(billingAccountId)}/usage`;
		const scoped = (path: string, extra: Record<string, string> = {}) => {
			const query = new URLSearchParams({ ...extra, ...(entityId === null ? {} : { entityId }) });
			return `${path}${query.size ? `?${query}` : ""}`;
		};
		return {
			check: async (input: CheckInput, request?: RequestOptions) => {
				const body = usageBody(input, entityId);
				return transport.send(
					{
						path: `${base}/check`,
						method: "POST",
						body,
						validate: (value): CheckResult => {
							if (
								!object(value) ||
								!verdict(value) ||
								value.featureId !== body.featureId ||
								value.entityId !== entityId ||
								!timestamp(value.checkedAt) ||
								Object.hasOwn(value, "usageEventId")
							)
								protocol();
							if (value.kind === "boolean") {
								if (
									body.value !== undefined ||
									["usage", "rated", "balance", "operationId"].some((key) =>
										Object.hasOwn(value, key),
									)
								)
									protocol();
							} else if (value.kind !== "metered" || !metered(value) || body.value === undefined)
								protocol();
							return value as unknown as CheckResult;
						},
					},
					request,
				);
			},
			consume: async (input: ConsumeInput, request?: RequestOptions) => {
				const body = usageBody(input, entityId, true);
				if (body.value === undefined) invalid("consume requires value");
				const id = operationId(input.operationId);
				return transport.send(
					{
						path: `${base}/consume`,
						method: "POST",
						body,
						operation: {
							billingAccountId,
							entityId,
							operation: "consume",
							operationId: id,
							featureId: body.featureId,
						},
						validate: (value) => consumeResult(value, id, entityId, body.featureId),
					},
					request,
				);
			},
			getOperation: async (input: GetOperationInput, request?: RequestOptions) => {
				knownKeys(input, ["operation", "operationId"]);
				if (input.operation !== "consume")
					invalid("This preview supports recovery of consume operations");
				const id = operationId(input.operationId);
				return transport.send(
					{
						path: scoped(`${base}/operations/consume/${segment(id)}`),
						validate: (value): OperationResult => {
							if (!object(value) || value.operation !== "consume" || value.operationId !== id)
								protocol();
							if (value.status === "completed") {
								consumeResult(value.outcome, id, entityId);
								if (!timestamp(value.completedAt)) protocol();
							} else if (
								value.status !== "processing" ||
								value.outcome !== null ||
								value.completedAt !== null
							)
								protocol();
							return value as unknown as OperationResult;
						},
					},
					request,
				);
			},
			getReceipt: async (receiptId: string, request?: RequestOptions) => {
				const id = identifier(receiptId, "receiptId", 503);
				return transport.send(
					{
						path: scoped(`${base}/receipts/${segment(id)}`),
						validate: (value): UsageReceipt => {
							if (
								!object(value) ||
								!metered(value) ||
								value.receiptId !== id ||
								!string(value.usageEventId) ||
								value.billingAccountId !== billingAccountId ||
								value.entityId !== entityId ||
								value.operation !== "consume" ||
								!string(value.operationId) ||
								!timestamp(value.recordedAt) ||
								!(value.occurredAt === null || timestamp(value.occurredAt)) ||
								!Number.isSafeInteger(value.deductionCount) ||
								(value.deductionCount as number) < 0 ||
								!object(value.rating) ||
								!["direct", "pinned", "additive"].includes(String(value.rating.path)) ||
								!(value.rating.revision === null || Number.isSafeInteger(value.rating.revision))
							)
								protocol();
							return value as unknown as UsageReceipt;
						},
					},
					request,
				);
			},
			listReceiptDeductions: async (input: ReceiptDeductionsInput, request?: RequestOptions) => {
				knownKeys(input, ["receiptId", "cursor", "limit"]);
				const id = identifier(input.receiptId, "receiptId", 503);
				const limit = input.limit ?? 50;
				if (!Number.isInteger(limit) || limit < 1 || limit > 100)
					invalid("limit must be between 1 and 100");
				const query: Record<string, string> = { limit: String(limit) };
				if (input.cursor !== undefined) query.cursor = identifier(input.cursor, "cursor", 1024);
				return transport.send(
					{
						path: scoped(`${base}/receipts/${segment(id)}/deductions`, query),
						validate: (value): ReceiptDeductionPage => {
							if (
								!object(value) ||
								!Array.isArray(value.items) ||
								value.items.length > limit ||
								!nullableString(value.nextCursor) ||
								!value.items.every(
									(item) =>
										object(item) &&
										string(item.sourceKind) &&
										string(item.sourceKey) &&
										string(item.value) &&
										(item.expiresAt === null || timestamp(item.expiresAt)),
								)
							)
								protocol();
							return value as unknown as ReceiptDeductionPage;
						},
					},
					request,
				);
			},
		};
	};
	return Object.freeze({
		account: (billingAccountId: string): AccountHandle => {
			const id = identifier(billingAccountId, "billingAccountId");
			const path = `/v1/billing-accounts/${segment(id)}`;
			return Object.freeze({
				...usage(id, null),
				create: (request?: RequestOptions) =>
					transport.send(
						{ path, method: "PUT", body: {}, validate: (value) => accountResult(value, id) },
						request,
					),
				get: (request?: RequestOptions) =>
					transport.send({ path, validate: (value) => accountResult(value, id) }, request),
				entity: (entityId: string): EntityHandle => {
					const externalId = identifier(entityId, "entityId");
					const entityPath = `${path}/entities/${segment(externalId)}`;
					return Object.freeze({
						...usage(id, externalId),
						create: async (
							input: { kind: string; metadata?: Record<string, unknown> },
							request?: RequestOptions,
						) => {
							knownKeys(input, ["kind", "metadata"]);
							if (input.metadata !== undefined && !object(input.metadata))
								invalid("metadata must be an object");
							return transport.send(
								{
									path: `${path}/entities`,
									method: "POST",
									body: {
										externalId,
										kind: identifier(input.kind, "kind", 120),
										...(input.metadata === undefined ? {} : { metadata: input.metadata }),
									},
									validate: (value) => entityResult(value, externalId),
								},
								{ ...request, maxRetries: 0 },
							);
						},
						get: (request?: RequestOptions) =>
							transport.send(
								{ path: entityPath, validate: (value) => entityResult(value, externalId) },
								request,
							),
					});
				},
			});
		},
	});
}
