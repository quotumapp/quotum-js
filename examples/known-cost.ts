import { createQuotum, type QuotumOptions } from "../src/index.js";

/** Onboard separately; reuse a persisted job ID for every recovery attempt. */
export function knownCostBilling(config: QuotumOptions) {
	const quotum = createQuotum(config);
	return {
		onboard: (customerId: string) => quotum.account(customerId).create(),
		authorize: async (customerId: string, jobId: string, value: bigint) => {
			const result = await quotum.account(customerId).consume({
				featureId: "api_calls",
				value,
				operationId: jobId,
			});
			if (!result.allowed) return { allowed: false as const, reason: result.reason };
			return { allowed: true as const, receiptId: result.receiptId };
		},
	};
}
