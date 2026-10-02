import type { operations } from "./generated/http.js";

type Data<T> = T extends {
	responses: { 200: { content: { "application/json": { data: infer D } } } };
}
	? D
	: T extends { responses: { 201: { content: { "application/json": { data: infer D } } } } }
		? D
		: never;

export type BillingAccount = Data<operations["getV1BillingAccountsByBillingAccountId"]>;
export type Entity = Data<operations["getV1BillingAccountsByBillingAccountIdEntitiesByEntityId"]>;
export type CheckResult = Data<operations["postV1BillingAccountsByBillingAccountIdUsageCheck"]>;
export type ConsumeResult = Data<operations["postV1BillingAccountsByBillingAccountIdUsageConsume"]>;
export type UsageReceipt = Data<
	operations["getV1BillingAccountsByBillingAccountIdUsageReceiptsByReceiptId"]
>;
export type ReceiptDeductionPage = Data<
	operations["getV1BillingAccountsByBillingAccountIdUsageReceiptsByReceiptIdDeductions"]
>;
export type OperationResult = {
	operation: "consume";
	operationId: string;
} & (
	| { status: "processing"; outcome: null; completedAt: null }
	| { status: "completed"; outcome: ConsumeResult; completedAt: string }
);

export type Value = string | number | bigint;
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;
export interface RequestOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	maxRetries?: number;
	requestId?: string;
}
export interface QuotumOptions {
	baseUrl: string;
	apiKey: string;
	fetch?: Fetch;
	timeoutMs?: number;
	maxRetries?: number;
}
export interface CheckInput {
	featureId: string;
	value?: Value;
	occurredAt?: string;
}
export interface ConsumeInput extends CheckInput {
	value: Value;
	operationId: string;
}
export interface GetOperationInput {
	operation: "consume";
	operationId: string;
}
export interface ReceiptDeductionsInput {
	receiptId: string;
	cursor?: string;
	limit?: number;
}
export interface UsageHandle {
	check(input: CheckInput, options?: RequestOptions): Promise<CheckResult>;
	consume(input: ConsumeInput, options?: RequestOptions): Promise<ConsumeResult>;
	getOperation(input: GetOperationInput, options?: RequestOptions): Promise<OperationResult>;
	getReceipt(receiptId: string, options?: RequestOptions): Promise<UsageReceipt>;
	listReceiptDeductions(
		input: ReceiptDeductionsInput,
		options?: RequestOptions,
	): Promise<ReceiptDeductionPage>;
}
export interface EntityHandle extends UsageHandle {
	create(
		input: { kind: string; metadata?: Record<string, unknown> },
		options?: RequestOptions,
	): Promise<Entity>;
	get(options?: RequestOptions): Promise<Entity>;
}
export interface AccountHandle extends UsageHandle {
	create(options?: RequestOptions): Promise<BillingAccount>;
	get(options?: RequestOptions): Promise<BillingAccount>;
	entity(entityId: string): EntityHandle;
}
export interface Quotum {
	account(billingAccountId: string): AccountHandle;
}
