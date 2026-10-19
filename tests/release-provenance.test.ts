import { expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyAuditedProvenance } from "../scripts/release-provenance.js";

const repository = "https://github.com/quotumapp/quotum-js";
const expected = { version: "0.1.0-rc.0", revision: "a".repeat(40), sha512: "b".repeat(128) };
const ref = `refs/tags/v${expected.version}`;
// Self-signed fixture tests identity parsing only. Signature/trust verification is
// delegated to the npm CLI before this helper is called, never to this fixture.
const certificate = new X509Certificate(
	readFileSync(new URL("fixtures/release-identity.pem", import.meta.url)),
).raw.toString("base64");
function fixture() {
	const statement = {
		_type: "https://in-toto.io/Statement/v1",
		predicateType: "https://slsa.dev/provenance/v1",
		subject: [
			{ name: `pkg:npm/%40quotum/sdk@${expected.version}`, digest: { sha512: expected.sha512 } },
		],
		predicate: {
			buildDefinition: {
				buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
				externalParameters: {
					workflow: { repository, path: ".github/workflows/release.yml", ref },
				},
				resolvedDependencies: [
					{ uri: `git+${repository}@${ref}`, digest: { gitCommit: expected.revision } },
				],
			},
		},
	};
	const bundle = {
		mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
		dsseEnvelope: {
			payloadType: "application/vnd.in-toto+json",
			payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
		},
		verificationMaterial: { certificate: { rawBytes: certificate } },
	};
	const report = {
		invalid: [] as unknown[],
		missing: [] as unknown[],
		verified: [
			{
				name: "@quotum/sdk",
				version: expected.version,
				attestationBundles: [{ predicateType: statement.predicateType, bundle }],
			},
		],
	};
	return { statement, bundle, report };
}

test("binds npm-verified provenance to the tested package and release source", () => {
	expect(verifyAuditedProvenance(fixture().report, expected)).toEqual({
		repository,
		revision: expected.revision,
		identity: `${repository}/.github/workflows/release.yml@${ref}`,
	});
});

test("rejects failed, missing or unsupported npm trust evidence", () => {
	for (const report of [
		{},
		{ ...fixture().report, invalid: [{}] },
		{ ...fixture().report, missing: [{}] },
		{ ...fixture().report, verified: [] },
	])
		expect(() => verifyAuditedProvenance(report, expected)).toThrow();
	const { report, bundle } = fixture();
	bundle.mediaType = "future-format";
	expect(() => verifyAuditedProvenance(report, expected)).toThrow("Unsupported");
});

test("rejects a different artifact, source commit, repository or signing identity", () => {
	for (const change of [
		{ sha512: "c".repeat(128) },
		{ revision: "d".repeat(40) },
		{ version: "0.1.0-rc.1" },
	])
		expect(() => verifyAuditedProvenance(fixture().report, { ...expected, ...change })).toThrow();
	const { report, bundle, statement } = fixture();
	statement.predicate.buildDefinition.externalParameters.workflow.repository =
		"https://github.com/other/repo";
	bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString("base64");
	expect(() => verifyAuditedProvenance(report, expected)).toThrow("source commit");
	bundle.verificationMaterial.certificate.rawBytes = "invalid-certificate";
	expect(() => verifyAuditedProvenance(report, expected)).toThrow();
});

test("accepts the verified legacy Sigstore certificate-chain representation", () => {
	const { report, bundle } = fixture();
	const legacy = {
		...bundle,
		mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.2",
		verificationMaterial: { x509CertificateChain: { certificates: [{ rawBytes: certificate }] } },
	};
	const item = report.verified[0];
	if (!item) throw new Error("Missing fixture");
	const result = {
		...report,
		verified: [
			{
				...item,
				attestationBundles: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: legacy }],
			},
		],
	};
	expect(verifyAuditedProvenance(result, expected).revision).toBe(expected.revision);
});
