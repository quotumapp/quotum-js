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
		void receipt;
		// @ts-expect-error Allowed results omit reason.
		result.reason;
	} else {
		const reason: string = result.reason;
		void reason;
		// @ts-expect-error Denials have no receipt identity.
		result.receiptId;
	}
	if (check.kind === "boolean") {
		// @ts-expect-error Boolean checks have no metered balance.
		check.balance;
	}
}
