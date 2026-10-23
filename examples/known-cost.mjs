import { createQuotum } from "../dist/index.js";

// In an application, import from '@quotum/sdk' after installing the packed package.
export function knownCostBilling(config) {
	const quotum = createQuotum(config);
	return {
		onboard: (customerId) => quotum.account(customerId).create(),
		authorize: (customerId, jobId, value) =>
			quotum.account(customerId).consume({
				featureId: "api_calls",
				value,
				operationId: jobId,
			}),
	};
}
