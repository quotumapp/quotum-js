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
export type ReserveResult = Data<
	operations["postV1BillingAccountsByBillingAccountIdUsageReservations"]
>;
export type ConfirmResult = Data<
	operations["postV1BillingAccountsByBillingAccountIdUsageReservationsByReservationIdConfirm"]
>;
export type ReleaseResult = Data<
	operations["postV1BillingAccountsByBillingAccountIdUsageReservationsByReservationIdRelease"]
>;
export type Reservation = Data<
	operations["getV1BillingAccountsByBillingAccountIdUsageReservationsByReservationId"]
>;
export type UsageReceipt = Data<
	operations["getV1BillingAccountsByBillingAccountIdUsageReceiptsByReceiptId"]
>;
export type ReceiptDeductionPage = Data<
	operations["getV1BillingAccountsByBillingAccountIdUsageReceiptsByReceiptIdDeductions"]
>;
export type UsageOperation = "consume" | "reserve" | "confirm" | "release";
export interface UsageOutcomes {
	consume: ConsumeResult;
	reserve: ReserveResult;
	confirm: ConfirmResult;
	release: ReleaseResult;
}
export type OperationResult<K extends UsageOperation = UsageOperation> = {
	[P in K]: { operation: P; operationId: string } & (
		| { status: "processing"; outcome: null; completedAt: null }
		| { status: "completed"; outcome: UsageOutcomes[P]; completedAt: string }
	);
}[K];

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
export interface ReserveInput {
	featureId: string;
	value: Value;
	operationId: string;
	expiresInSeconds?: number;
}
export interface ReleaseInput {
	reservationId: string;
	operationId: string;
}
export interface ConfirmInput extends ReleaseInput {
	value: Value;
}
export interface GetOperationInput<K extends UsageOperation = UsageOperation> {
	operation: K;
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
	reserve(input: ReserveInput, options?: RequestOptions): Promise<ReserveResult>;
	confirm(input: ConfirmInput, options?: RequestOptions): Promise<ConfirmResult>;
	release(input: ReleaseInput, options?: RequestOptions): Promise<ReleaseResult>;
	getReservation(reservationId: string, options?: RequestOptions): Promise<Reservation>;
	getOperation<K extends UsageOperation>(
		input: GetOperationInput<K>,
		options?: RequestOptions,
	): Promise<OperationResult<K>>;
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
