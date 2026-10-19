# SDK operation surface

Generated from the pinned HTTP contract and the authored method inventory. Only rows marked
`preview` have runtime methods. `account` means `quotum.account(id)`; `account.entity` means
`account.entity(id)`; `operator.account` is a future operator-scoped handle. All other rows
are reviewed targets, not stubs or promises that their current wire is already final.

Generated `HttpOperations[operationId]` defines each operation's HTTP inputs/responses; see
[the machine-readable coverage](contracts/v1/coverage.json) for its exact operation ID. Public
methods bind path scope, take an input object for the remaining domain fields and final request
options, and return a promise of the unwrapped data. Reads with no remaining inputs omit that
object. Existing preview signatures are authoritative in [src/types.ts](src/types.ts).

| Public method | Client | Delivery | HTTP operation |
| --- | --- | --- | --- |
| operator.account.debits.list | operator | planned | `GET /v1/admin/administrative-debits/{billingAccountId}` |
| operator.account.debits.create | operator | planned | `POST /v1/admin/administrative-debits/{billingAccountId}` |
| operator.account.autoTopup.reset | operator | planned | `POST /v1/admin/auto-topups/{billingAccountId}/{policyId}/reset` |
| operator.account.providerOperations.reconcile | operator | planned | `POST /v1/admin/billing-accounts/{billingAccountId}/provider-operations/{operationId}/reconcile` |
| quotum.catalog.getPublished | application | planned | `GET /v1/admin/catalog` |
| operator.catalogMigrations.preview | operator | planned | `POST /v1/admin/catalog-migrations/preview` |
| operator.catalogMigrations.publish | operator | planned | `POST /v1/admin/catalog-migrations/publish` |
| operator.catalog.listBindings | operator | planned | `GET /v1/admin/catalog/bindings` |
| operator.catalog.adoptBindings | operator | planned | `POST /v1/admin/catalog/bindings/adopt` |
| operator.catalog.preview | operator | planned | `POST /v1/admin/catalog/preview` |
| operator.catalog.listProducts | operator | planned | `GET /v1/admin/catalog/products` |
| operator.catalog.publish | operator | planned | `POST /v1/admin/catalog/publish` |
| operator.catalog.listStoreProducts | operator | planned | `GET /v1/admin/catalog/store-products` |
| operator.account.contracts.list | operator | planned | `GET /v1/admin/contracts/{billingAccountId}` |
| operator.account.contracts.remove | operator | planned | `DELETE /v1/admin/contracts/{billingAccountId}/{contractId}` |
| operator.contracts.preview | operator | planned | `POST /v1/admin/contracts/preview` |
| operator.contracts.publish | operator | planned | `POST /v1/admin/contracts/publish` |
| operator.customerErasures.create | operator | planned | `POST /v1/admin/customer-erasures` |
| operator.customerErasures.get | operator | planned | `GET /v1/admin/customer-erasures/{erasureId}` |
| operator.customerErasures.preview | operator | planned | `POST /v1/admin/customer-erasures/preview` |
| quotum.support.customers.get | application | planned | `GET /v1/admin/customers/{customerId}` |
| quotum.support.customers.listProjectionJobs | application | planned | `GET /v1/admin/customers/{customerId}/projection-jobs` |
| quotum.support.customers.listPurchases | application | planned | `GET /v1/admin/customers/{customerId}/purchases` |
| quotum.support.customers.listStoreEvents | application | planned | `GET /v1/admin/customers/{customerId}/store-events` |
| quotum.support.customers.listSubscriptions | application | planned | `GET /v1/admin/customers/{customerId}/subscriptions` |
| account.support.getCustomer | application | planned | `GET /v1/admin/customers/by-billing-account/{billingAccountId}` |
| quotum.support.customers.search | application | planned | `GET /v1/admin/customers/search` |
| operator.metrics | operator | planned | `GET /v1/admin/metrics` |
| operator.account.grants.list | operator | planned | `GET /v1/admin/operator-grants/{billingAccountId}` |
| operator.account.grants.create | operator | planned | `POST /v1/admin/operator-grants/{billingAccountId}` |
| operator.account.grants.get | operator | planned | `GET /v1/admin/operator-grants/{billingAccountId}/{grantId}` |
| operator.account.grants.revoke | operator | planned | `POST /v1/admin/operator-grants/{billingAccountId}/{grantId}/revoke` |
| quotum.support.projectionJobs.list | application | planned | `GET /v1/admin/projection-jobs` |
| operator.projectionJobs.retry | operator | planned | `POST /v1/admin/projection-jobs/{jobId}/retry` |
| operator.promotions.revokeRedemption | operator | planned | `POST /v1/admin/promotion-redemptions/{redemptionId}/revoke` |
| operator.promotions.list | operator | planned | `GET /v1/admin/promotions` |
| operator.promotions.create | operator | planned | `POST /v1/admin/promotions` |
| operator.promotions.get | operator | planned | `GET /v1/admin/promotions/{promotionKey}` |
| operator.promotions.linkAppleOffer | operator | planned | `POST /v1/admin/promotions/{promotionKey}/apple-offers` |
| operator.promotions.retireAppleOffer | operator | planned | `POST /v1/admin/promotions/{promotionKey}/apple-offers/{offerId}/retire` |
| operator.promotions.archive | operator | planned | `POST /v1/admin/promotions/{promotionKey}/archive` |
| operator.promotions.listCodes | operator | planned | `GET /v1/admin/promotions/{promotionKey}/codes` |
| operator.promotions.createCodes | operator | planned | `POST /v1/admin/promotions/{promotionKey}/codes` |
| operator.promotions.deactivateCode | operator | planned | `POST /v1/admin/promotions/{promotionKey}/codes/{codeId}/deactivate` |
| operator.promotions.syncProvider | operator | planned | `POST /v1/admin/promotions/{promotionKey}/provider-sync` |
| operator.promotions.listRedemptions | operator | planned | `GET /v1/admin/promotions/{promotionKey}/redemptions` |
| operator.promotions.updateTerms | operator | planned | `POST /v1/admin/promotions/{promotionKey}/terms` |
| operator.account.providerCustomerUnlinks.list | operator | planned | `GET /v1/admin/provider-customer-unlinks/{billingAccountId}` |
| operator.account.providerCustomerUnlinks.create | operator | planned | `POST /v1/admin/provider-customer-unlinks/{billingAccountId}` |
| quotum.providers.capabilities | application | planned | `GET /v1/admin/providers/capabilities` |
| quotum.support.purchases.list | application | planned | `GET /v1/admin/purchases` |
| operator.reconciliation.runSubscriptions | operator | planned | `POST /v1/admin/reconciliation/subscriptions/run` |
| quotum.support.stats | application | planned | `GET /v1/admin/stats/summary` |
| quotum.support.storeEvents.list | application | planned | `GET /v1/admin/store-events` |
| quotum.support.storeEvents.get | application | planned | `GET /v1/admin/store-events/{eventId}` |
| operator.storeEvents.replay | operator | planned | `POST /v1/admin/store-events/{eventId}/replay` |
| operator.subscriptionChanges.retry | operator | planned | `POST /v1/admin/subscription-changes/{changeId}/retry` |
| quotum.support.subscriptions.list | application | planned | `GET /v1/admin/subscriptions` |
| quotum.support.usageEvents.list | application | planned | `GET /v1/admin/usage-events` |
| operator.usageInvoiceAdjustments.retry | operator | planned | `POST /v1/admin/usage-invoice-adjustments/{adjustmentId}/retry` |
| operator.usageInvoicePeriods.retry | operator | planned | `POST /v1/admin/usage-invoice-periods/{periodId}/retry` |
| operator.webhookDeliveries.list | operator | planned | `GET /v1/admin/webhook-deliveries` |
| operator.webhookDeliveries.retry | operator | planned | `POST /v1/admin/webhook-deliveries/{deliveryId}/retry` |
| operator.webhookEndpoints.list | operator | planned | `GET /v1/admin/webhook-endpoints` |
| operator.webhookEndpoints.create | operator | planned | `POST /v1/admin/webhook-endpoints` |
| operator.webhookEndpoints.remove | operator | planned | `DELETE /v1/admin/webhook-endpoints/{endpointId}` |
| operator.webhookEndpoints.get | operator | planned | `GET /v1/admin/webhook-endpoints/{endpointId}` |
| operator.webhookEndpoints.update | operator | planned | `PATCH /v1/admin/webhook-endpoints/{endpointId}` |
| operator.webhookEndpoints.replay | operator | planned | `POST /v1/admin/webhook-endpoints/{endpointId}/replay` |
| operator.webhookEndpoints.rotateSecret | operator | planned | `POST /v1/admin/webhook-endpoints/{endpointId}/rotate-secret` |
| operator.webhookEndpoints.test | operator | planned | `POST /v1/admin/webhook-endpoints/{endpointId}/test` |
| operator.webhookEndpoints.eventTypes | operator | planned | `GET /v1/admin/webhook-event-types` |
| account.get | application | preview | `GET /v1/billing-accounts/{billingAccountId}` |
| account.create | application | preview | `PUT /v1/billing-accounts/{billingAccountId}` |
| account.autoTopup.get | application | planned | `GET /v1/billing-accounts/{billingAccountId}/auto-topup` |
| account.autoTopup.set | application | planned | `PUT /v1/billing-accounts/{billingAccountId}/auto-topup` |
| account.availableActions | application | planned | `GET /v1/billing-accounts/{billingAccountId}/available-actions` |
| account.balances.get | application | planned | `GET /v1/billing-accounts/{billingAccountId}/balances/{featureKey}` |
| account.stripe.getBillingAccount | application | planned | `GET /v1/billing-accounts/{billingAccountId}/billing-account` |
| account.billingSummary | application | planned | `GET /v1/billing-accounts/{billingAccountId}/billing-summary` |
| account.commercial.execute | application | planned | `POST /v1/billing-accounts/{billingAccountId}/commercial-actions` |
| account.commercial.preview | application | planned | `POST /v1/billing-accounts/{billingAccountId}/commercial-actions/preview` |
| account.controls.get | application | planned | `GET /v1/billing-accounts/{billingAccountId}/controls` |
| account.controls.set | application | planned | `PUT /v1/billing-accounts/{billingAccountId}/controls` |
| account.listEntities | application | planned | `GET /v1/billing-accounts/{billingAccountId}/entities` |
| account.entity.create | application | preview | `POST /v1/billing-accounts/{billingAccountId}/entities` |
| account.entity.get | application | preview | `GET /v1/billing-accounts/{billingAccountId}/entities/{entityId}` |
| account.entity.licenses.check | application | planned | `GET /v1/billing-accounts/{billingAccountId}/entities/{entityId}/licenses/{featureKey}` |
| account.entitlements | application | planned | `GET /v1/billing-accounts/{billingAccountId}/entitlements` |
| account.promotions.gifts | application | planned | `GET /v1/billing-accounts/{billingAccountId}/gifts` |
| account.invoices.list | application | planned | `GET /v1/billing-accounts/{billingAccountId}/invoices` |
| account.invoices.get | application | planned | `GET /v1/billing-accounts/{billingAccountId}/invoices/{invoiceId}` |
| account.licenses.assign | application | planned | `POST /v1/billing-accounts/{billingAccountId}/license-assignments` |
| account.licenses.revoke | application | planned | `DELETE /v1/billing-accounts/{billingAccountId}/license-assignments/{assignmentId}` |
| account.licenses.listPools | application | planned | `GET /v1/billing-accounts/{billingAccountId}/license-pools` |
| account.paymentSetup.getSession | application | planned | `GET /v1/billing-accounts/{billingAccountId}/payment-setup-sessions/{sessionId}` |
| account.promotions.validate | application | planned | `POST /v1/billing-accounts/{billingAccountId}/promotion-codes/validate` |
| account.promotions.listRedemptions | application | planned | `GET /v1/billing-accounts/{billingAccountId}/promotion-redemptions` |
| account.promotions.redeem | application | planned | `POST /v1/billing-accounts/{billingAccountId}/promotion-redemptions` |
| account.promotions.getRedemption | application | planned | `GET /v1/billing-accounts/{billingAccountId}/promotion-redemptions/{redemptionId}` |
| account.promotions.appleSignatures | application | planned | `POST /v1/billing-accounts/{billingAccountId}/promotion-redemptions/{redemptionId}/apple-signatures` |
| account.providerOperations.get | application | planned | `GET /v1/billing-accounts/{billingAccountId}/provider-operations/{operationId}` |
| account.apple.getAccountToken | application | planned | `GET /v1/billing-accounts/{billingAccountId}/providers/apple/account-token` |
| account.google.getAccountLink | application | planned | `GET /v1/billing-accounts/{billingAccountId}/providers/google/account-link` |
| account.paddle.createCheckout | application | planned | `POST /v1/billing-accounts/{billingAccountId}/providers/paddle/checkout-sessions` |
| account.stripe.createCheckout | application | planned | `POST /v1/billing-accounts/{billingAccountId}/providers/stripe/checkout-sessions` |
| account.stripe.getCheckout | application | planned | `GET /v1/billing-accounts/{billingAccountId}/providers/stripe/checkout-sessions/{sessionId}` |
| account.stripe.expireCheckout | application | planned | `POST /v1/billing-accounts/{billingAccountId}/providers/stripe/checkout-sessions/{sessionId}/expire` |
| account.stripe.createPortal | application | planned | `POST /v1/billing-accounts/{billingAccountId}/providers/stripe/portal-sessions` |
| account.refunds.list | application | planned | `GET /v1/billing-accounts/{billingAccountId}/refunds` |
| account.subscriptions.change | application | planned | `POST /v1/billing-accounts/{billingAccountId}/subscriptions/{subscriptionId}/changes` |
| account.trials.eligibility | application | planned | `GET /v1/billing-accounts/{billingAccountId}/trial-eligibility` |
| account.trials.list | application | planned | `GET /v1/billing-accounts/{billingAccountId}/trials` |
| account.trials.start | application | planned | `POST /v1/billing-accounts/{billingAccountId}/trials` |
| account.trials.get | application | planned | `GET /v1/billing-accounts/{billingAccountId}/trials/{trialId}` |
| account.trials.end | application | planned | `POST /v1/billing-accounts/{billingAccountId}/trials/{trialId}/end` |
| account.alerts.listEvents | application | planned | `GET /v1/billing-accounts/{billingAccountId}/usage-alert-events` |
| account.alerts.list | application | planned | `GET /v1/billing-accounts/{billingAccountId}/usage-alerts` |
| account.alerts.create | application | planned | `POST /v1/billing-accounts/{billingAccountId}/usage-alerts` |
| account.check / entity.check | application | preview | `POST /v1/billing-accounts/{billingAccountId}/usage/check` |
| account.consume / entity.consume | application | preview | `POST /v1/billing-accounts/{billingAccountId}/usage/consume` |
| account.usage.listEvents | application | planned | `GET /v1/billing-accounts/{billingAccountId}/usage/events` |
| account.usage.correct | application | planned | `POST /v1/billing-accounts/{billingAccountId}/usage/events/{usageEventId}/corrections` |
| account.getOperation / entity.getOperation | application | preview | `GET /v1/billing-accounts/{billingAccountId}/usage/operations/{operation}/{operationId}` |
| account.getReceipt / entity.getReceipt | application | preview | `GET /v1/billing-accounts/{billingAccountId}/usage/receipts/{receiptId}` |
| account.listReceiptDeductions / entity.listReceiptDeductions | application | preview | `GET /v1/billing-accounts/{billingAccountId}/usage/receipts/{receiptId}/deductions` |
| account.reserve / entity.reserve | application | preview | `POST /v1/billing-accounts/{billingAccountId}/usage/reservations` |
| account.getReservation / entity.getReservation | application | preview | `GET /v1/billing-accounts/{billingAccountId}/usage/reservations/{reservationId}` |
| account.confirm / entity.confirm | application | preview | `POST /v1/billing-accounts/{billingAccountId}/usage/reservations/{reservationId}/confirm` |
| account.release / entity.release | application | preview | `POST /v1/billing-accounts/{billingAccountId}/usage/reservations/{reservationId}/release` |
| account.usage.series | application | planned | `GET /v1/billing-accounts/{billingAccountId}/usage/series` |
| quotum.catalog.list | application | planned | `GET /v1/catalog` |
| Webhook ingress | excluded_ingress | excluded | `POST /v1/projects/{projectKey}/connections/{versionId}/webhooks/{provider}` |
| Webhook ingress | excluded_ingress | excluded | `POST /v1/projects/{projectKey}/webhooks/apple` |
| Webhook ingress | excluded_ingress | excluded | `POST /v1/projects/{projectKey}/webhooks/google` |
| Webhook ingress | excluded_ingress | excluded | `POST /v1/projects/{projectKey}/webhooks/paddle` |
| Webhook ingress | excluded_ingress | excluded | `POST /v1/projects/{projectKey}/webhooks/stripe` |
| account.purchases.verify | application | planned | `POST /v1/purchases/verify` |
| Webhook ingress | excluded_ingress | excluded | `POST /v1/stripe-app/webhooks/{mode}` |
