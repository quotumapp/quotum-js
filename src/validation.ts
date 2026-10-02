import { invalid, QuotumError } from "./errors.js";
import type { ConsumeResult, Value } from "./types.js";

export function identifier(value: unknown, name: string, max = 200): string {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > max ||
		value.trim() !== value ||
		[...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	)
		invalid(
			`${name} must be a nonempty identifier without surrounding whitespace or control characters`,
		);
	return value;
}
export function segment(value: string): string {
	// URL parsing normalizes these even when percent encoded. Never address a different resource.
	if (value === "." || value === "..") invalid("A path identifier cannot be a dot segment");
	try {
		return encodeURIComponent(value);
	} catch {
		return invalid("An identifier contains invalid Unicode");
	}
}
export function decimal(value: Value): string {
	if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0))
		invalid("Numeric values must be positive safe integers; use a string for fractions");
	if (!["string", "number", "bigint"].includes(typeof value))
		invalid("value must be a decimal string, safe integer or bigint");
	const raw = String(value);
	if (raw.length > 80 || !/^\d+(?:\.\d+)?$/u.test(raw))
		invalid("value must be a positive decimal without whitespace or exponent notation");
	const [integer = "", fraction = ""] = raw.split(".");
	const whole = integer.replace(/^0+(?=\d)/u, "");
	const tail = fraction.replace(/0+$/, "");
	if (whole.length > 19 || tail.length > 9 || (whole === "0" && !tail))
		invalid("value must be positive with at most 19 integer digits and 9 decimal places");
	return tail ? `${whole}.${tail}` : whole;
}
export function knownKeys(
	value: unknown,
	allowed: string[],
): asserts value is Record<string, unknown> {
	if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
		invalid(`Expected an object containing only ${allowed.join(", ")}`);
}
export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
export const timestamp = (value: unknown): value is string =>
	typeof value === "string" && Number.isFinite(Date.parse(value));
export const string = (value: unknown): value is string => typeof value === "string";
export const nullableString = (value: unknown): value is string | null =>
	value === null || string(value);
export function protocol(): never {
	throw new QuotumError("PROTOCOL_ERROR", "Quotum returned an invalid response");
}
const numeric = (value: unknown) => string(value) && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value);
function quantity(value: unknown): boolean {
	return object(value) && string(value.featureId) && string(value.unit) && numeric(value.value);
}
const optionalTimestamp = (value: Record<string, unknown>, key: string) =>
	!Object.hasOwn(value, key) || timestamp(value[key]);
/**
 * A compact balance. An unlimited quota reports `unlimited: true` with null `granted` and
 * `available`; a meter limit adds its `scope` and current window bounds.
 */
function balance(value: unknown): boolean {
	if (!object(value) || !string(value.featureId) || !string(value.unit)) return false;
	if (!numeric(value.consumed) || !numeric(value.held)) return false;
	const unlimited = Object.hasOwn(value, "unlimited");
	if (unlimited && value.unlimited !== true) return false;
	const finite = (key: string) => (unlimited ? value[key] === null : numeric(value[key]));
	return (
		finite("granted") &&
		finite("available") &&
		(!Object.hasOwn(value, "scope") || ["account", "entity"].includes(String(value.scope))) &&
		optionalTimestamp(value, "windowStartAt") &&
		optionalTimestamp(value, "windowEndAt") &&
		!Object.hasOwn(value, "breakdown")
	);
}
export function metered(value: Record<string, unknown>): boolean {
	return (
		string(value.featureId) &&
		nullableString(value.entityId) &&
		quantity(value.usage) &&
		quantity(value.rated) &&
		balance(value.balance) &&
		!["deductions", "rateCard", "eligiblePurchaseActions"].some((key) => Object.hasOwn(value, key))
	);
}
export function verdict(value: Record<string, unknown>): boolean {
	if (value.allowed === true) return !Object.hasOwn(value, "reason");
	if (
		value.allowed !== false ||
		!["not_entitled", "insufficient_balance", "control_limit_exceeded"].includes(
			String(value.reason),
		)
	)
		return false;
	if (value.reason !== "control_limit_exceeded") return true;
	return (
		object(value.control) &&
		["spend_limit", "usage_limit"].includes(String(value.control.kind)) &&
		["account", "entity", "plan_default", "contract"].includes(String(value.control.source)) &&
		Number.isInteger(value.control.revision) &&
		string(value.control.policyId) &&
		["limitValue", "currentValue", "requestedValue", "remainingValue"].every((key) =>
			numeric((value.control as Record<string, unknown>)[key]),
		)
	);
}
export function consumeResult(
	value: unknown,
	operationId: string,
	entityId: string | null,
	featureId?: string,
): ConsumeResult {
	if (
		!object(value) ||
		!metered(value) ||
		!verdict(value) ||
		value.operation !== "consume" ||
		value.operationId !== operationId ||
		value.entityId !== entityId ||
		(featureId !== undefined && value.featureId !== featureId)
	)
		protocol();
	if (
		value.allowed
			? !string(value.receiptId) || !string(value.usageEventId) || !timestamp(value.recordedAt)
			: ["receiptId", "usageEventId", "recordedAt"].some((key) => Object.hasOwn(value, key))
	)
		protocol();
	return value as unknown as ConsumeResult;
}
