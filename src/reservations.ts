import { invalid, QuotumError } from "./errors.js";
import type { Transport } from "./transport.js";
import type {
	ConfirmInput,
	ReleaseInput,
	RequestOptions,
	Reservation,
	ReserveInput,
	UsageHandle,
	UsageOperation,
	UsageOutcomes,
} from "./types.js";
import {
	consumeResult,
	decimal,
	identifier,
	knownKeys,
	metered,
	nullableString,
	numeric,
	object,
	protocol,
	quantity,
	segment,
	string,
	timestamp,
	verdict,
} from "./validation.js";

export function operationIdentifier(value: unknown): string {
	const id = identifier(value, "operationId");
	if (!/^[\x20-\x7e]+$/u.test(id))
		invalid("operationId must contain printable ASCII for the Idempotency-Key header");
	return id;
}

export function reservationResult(
	value: unknown,
	billingAccountId: string,
	entityId: string | null,
): Reservation {
	if (
		!object(value) ||
		!string(value.reservationId) ||
		value.billingAccountId !== billingAccountId ||
		!string(value.featureId) ||
		!nullableString(value.entityId) ||
		!quantity(value.usage) ||
		value.usage.featureId !== value.featureId ||
		!timestamp(value.createdAt) ||
		!timestamp(value.expiresAt) ||
		!nullableString(value.receiptId) ||
		!["active", "confirmed", "released", "expired"].includes(String(value.status))
	)
		protocol();
	if (value.status === "active" ? value.finalizedAt !== null : !timestamp(value.finalizedAt))
		protocol();
	if (value.status === "confirmed" ? !numeric(value.confirmedValue) : value.confirmedValue !== null)
		protocol();
	if (value.status !== "confirmed" && value.receiptId !== null) protocol();
	if (value.entityId !== entityId)
		throw new QuotumError(
			"RESERVATION_NOT_FOUND",
			"Reservation was not found in this handle's entity scope",
			{ status: 404 },
		);
	return value as unknown as Reservation;
}

export function usageOutcome<K extends UsageOperation>(
	operation: K,
	value: unknown,
	operationId: string,
	entityId: string | null,
	featureId?: string,
	reservationId?: string,
): UsageOutcomes[K] {
	if (operation === "consume")
		return consumeResult(value, operationId, entityId, featureId) as UsageOutcomes[K];
	if (
		!object(value) ||
		value.operation !== operation ||
		value.operationId !== operationId ||
		value.entityId !== entityId ||
		!string(value.featureId) ||
		(featureId !== undefined && value.featureId !== featureId) ||
		(reservationId !== undefined && value.reservationId !== reservationId)
	)
		protocol();
	if (operation === "release") {
		if (
			Object.hasOwn(value, "allowed") ||
			!string(value.reservationId) ||
			!["confirmed", "released", "expired"].includes(String(value.status)) ||
			!timestamp(value.finalizedAt)
		)
			protocol();
	} else {
		if (!metered(value)) protocol();
		if (operation === "reserve") {
			if (
				!verdict(value) ||
				(value.allowed
					? value.status !== "active" || !string(value.reservationId) || !timestamp(value.expiresAt)
					: ["reservationId", "status", "expiresAt"].some((key) => Object.hasOwn(value, key)))
			)
				protocol();
			if (["receiptId", "usageEventId", "recordedAt"].some((key) => Object.hasOwn(value, key)))
				protocol();
		} else {
			if (!string(value.reservationId)) protocol();
			if (value.allowed === true) {
				if (
					!verdict(value) ||
					value.status !== "confirmed" ||
					!string(value.receiptId) ||
					!string(value.usageEventId) ||
					!timestamp(value.recordedAt)
				)
					protocol();
			} else {
				if (
					value.status === "expired"
						? value.allowed !== false || value.reason !== "reservation_expired"
						: value.status !== "active" || !verdict(value)
				)
					protocol();
				if (["receiptId", "usageEventId", "recordedAt"].some((key) => Object.hasOwn(value, key)))
					protocol();
			}
		}
	}
	return value as unknown as UsageOutcomes[K];
}

export function reservationMethods(
	transport: Transport,
	billingAccountId: string,
	entityId: string | null,
): Pick<UsageHandle, "reserve" | "confirm" | "release" | "getReservation"> {
	const base = `/v1/billing-accounts/${segment(billingAccountId)}/usage/reservations`;
	const finalize = <K extends "confirm" | "release">(
		operation: K,
		input: ReleaseInput,
		body: object,
		request?: RequestOptions,
	) => {
		const reservationId = identifier(input.reservationId, "reservationId");
		const operationId = operationIdentifier(input.operationId);
		const path = `${base}/${segment(reservationId)}`;
		return transport.send<UsageOutcomes[K]>(
			{
				path: `${path}/${operation}`,
				method: "POST",
				body,
				operation: { billingAccountId, entityId, operation, operationId },
				preflight: {
					path,
					validate: (value) => {
						if (
							reservationResult(value, billingAccountId, entityId).reservationId !== reservationId
						)
							protocol();
					},
				},
				validate: (value) =>
					usageOutcome(operation, value, operationId, entityId, undefined, reservationId),
			},
			request,
		);
	};
	return {
		reserve: async (input: ReserveInput, request?: RequestOptions) => {
			knownKeys(input, ["featureId", "value", "operationId", "expiresInSeconds"]);
			const featureId = identifier(input.featureId, "featureId", 120);
			const value = decimal(input.value);
			const operationId = operationIdentifier(input.operationId);
			if (
				input.expiresInSeconds !== undefined &&
				(!Number.isInteger(input.expiresInSeconds) ||
					input.expiresInSeconds < 1 ||
					input.expiresInSeconds > 86400)
			)
				invalid("expiresInSeconds must be an integer between 1 and 86400");
			return transport.send(
				{
					path: base,
					method: "POST",
					body: {
						featureId,
						value,
						...(entityId === null ? {} : { entityId }),
						...(input.expiresInSeconds === undefined
							? {}
							: { expiresInSeconds: input.expiresInSeconds }),
					},
					operation: { billingAccountId, entityId, operation: "reserve", operationId, featureId },
					validate: (result) => usageOutcome("reserve", result, operationId, entityId, featureId),
				},
				request,
			);
		},
		confirm: async (input: ConfirmInput, request?: RequestOptions) => {
			knownKeys(input, ["reservationId", "value", "operationId"]);
			return finalize("confirm", input, { value: decimal(input.value) }, request);
		},
		release: async (input: ReleaseInput, request?: RequestOptions) => {
			knownKeys(input, ["reservationId", "operationId"]);
			return finalize("release", input, {}, request);
		},
		getReservation: async (reservationId: string, request?: RequestOptions) =>
			transport.send(
				{
					path: `${base}/${segment(identifier(reservationId, "reservationId"))}`,
					validate: (value) => {
						const result = reservationResult(value, billingAccountId, entityId);
						if (result.reservationId !== reservationId) protocol();
						return result;
					},
				},
				request,
			),
	};
}
