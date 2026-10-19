import type { CheckResult, ConsumeResult, Quotum } from "../src/index.js";

export function typeAssertions(quotum: Quotum, result: ConsumeResult, check: CheckResult) {
	quotum.account("payer").consume({ featureId: "credits", value: "0.125", operationId: "job" });
	quotum.account("payer").consume({ featureId: "credits", value: 1n, operationId: "job" });
	// @ts-expect-error Every consume needs a caller-owned operationId.
	quotum.account("payer").consume({ featureId: "credits", value: 1 });
	// @ts-expect-error Legacy wire names are not public aliases.
	quotum.account("payer").check({ featureKey: "credits", quantity: "1" });
	quotum.account("payer").consume({
		featureId: "credits",
		value: 1,
		operationId: "job",
		// @ts-expect-error No caller metadata on usage.
		metadata: {},
	});
	if (result.allowed) {
		const receipt: string = result.receiptId;
		const usageEventId: string = result.usageEventId;
		void receipt;
		void usageEventId;
		// @ts-expect-error Allowed results omit reason.
		result.reason;
	} else {
		const reason: string = result.reason;
		void reason;
		// @ts-expect-error Denials have no receipt identity.
		result.receiptId;
		// @ts-expect-error Denials record no usage event.
		result.usageEventId;
	}
	// An unlimited quota grants no finite amount.
	const granted: string | null = result.balance.granted;
	const available: string | null = result.balance.available;
	// @ts-expect-error A finite amount may be absent.
	const finite: string = result.balance.available;
	void granted;
	void available;
	void finite;
	if (check.kind === "boolean") {
		// @ts-expect-error Boolean checks have no metered balance.
		check.balance;
	}
}

export async function reservationTypes(quotum: Quotum) {
	const account = quotum.account("payer");
	const reserved = await account.reserve({ featureId: "tokens", value: 100n, operationId: "job" });
	if (reserved.allowed) {
		await account.confirm({
			reservationId: reserved.reservationId,
			value: "60",
			operationId: "job",
		});
	} else {
		// @ts-expect-error A denied reservation has no hold identity.
		reserved.reservationId;
	}
	const result = await account.getOperation({ operation: "confirm", operationId: "job" });
	if (result.status === "completed" && result.outcome.allowed) {
		const receipt: string = result.outcome.receiptId;
		void receipt;
	}
	const released = await account.release({ reservationId: "hold", operationId: "job" });
	// @ts-expect-error Release reports state, not an authorization verdict.
	released.allowed;
	// @ts-expect-error Confirm always needs an actual value.
	account.confirm({ reservationId: "hold", operationId: "job" });
	account.entity("child").reserve({
		featureId: "tokens",
		value: 100,
		operationId: "job",
		// @ts-expect-error Entity scope is bound by the handle, never overridden.
		entityId: "other",
	});
}
