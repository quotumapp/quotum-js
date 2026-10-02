import { createQuotum } from "../dist/index.js";

// In an application, import from '@quotum/sdk' after installing the packed package.
export function knownCostBilling(config) {
	const quotum = createQuotum(config);
	return {
		onboard: (customerId) => quotum.account(customerId).create(),
		authorize: (customerId, jobId, tokens) =>
			quotum.account(customerId).consume({
				featureId: "model_tokens",
				value: tokens,
				operationId: jobId,
			}),
	};
}
