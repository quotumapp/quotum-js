import { X509Certificate } from "node:crypto";

const slsa = "https://slsa.dev/provenance/v1";
const buildType = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const repository = "https://github.com/quotumapp/quotum-js";
type Bundle = {
	mediaType: string;
	dsseEnvelope: { payloadType: string; payload: string };
	verificationMaterial: {
		certificate?: { rawBytes: string };
		x509CertificateChain?: { certificates: { rawBytes: string }[] };
	};
};
type Audit = {
	invalid: unknown[];
	missing: unknown[];
	verified: {
		name: string;
		version: string;
		attestationBundles?: { predicateType: string; bundle: Bundle }[];
	}[];
};

// Input must be the successful `npm audit signatures --json --include-attestations`
// result. npm verifies Sigstore signatures, certificates and transparency evidence;
// these checks additionally bind its verified bundle to this release's source.
export function verifyAuditedProvenance(
	auditResult: unknown,
	expected: { version: string; revision: string; sha512: string },
) {
	const audit = auditResult as Audit;
	if (
		!Array.isArray(audit?.invalid) ||
		!Array.isArray(audit.missing) ||
		audit.invalid.length ||
		audit.missing.length ||
		!Array.isArray(audit.verified)
	)
		throw new Error("npm signature verification did not succeed");
	if (!/^[a-f0-9]{40}$/.test(expected.revision))
		throw new Error("An immutable release commit is required");
	const verified = audit.verified.find(
		(item) => item.name === "@quotum/sdk" && item.version === expected.version,
	);
	const attestations = verified?.attestationBundles?.filter((item) => item.predicateType === slsa);
	if (attestations?.length !== 1) throw new Error("One verified SLSA v1 provenance is required");
	const bundle = attestations[0]?.bundle;
	if (
		!bundle ||
		!new Set([
			"application/vnd.dev.sigstore.bundle+json;version=0.1",
			"application/vnd.dev.sigstore.bundle+json;version=0.2",
			"application/vnd.dev.sigstore.bundle.v0.3+json",
		]).has(bundle.mediaType) ||
		bundle.dsseEnvelope?.payloadType !== "application/vnd.in-toto+json"
	)
		throw new Error("Unsupported npm provenance bundle format");
	const ref = `refs/tags/v${expected.version}`;
	const identity = `${repository}/.github/workflows/release.yml@${ref}`;
	const certificate =
		bundle.verificationMaterial.certificate?.rawBytes ??
		bundle.verificationMaterial.x509CertificateChain?.certificates[0]?.rawBytes;
	if (
		!certificate ||
		new X509Certificate(Buffer.from(certificate, "base64")).subjectAltName !== `URI:${identity}`
	)
		throw new Error("The signing certificate belongs to another source workflow");
	// This is the explicitly supported npm GitHub Actions SLSA v1 predicate.
	// Other predicates or future shapes fail closed instead of guessing field names.
	const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
	const definition = statement.predicate?.buildDefinition;
	const workflow = definition?.externalParameters?.workflow;
	const dependencies = definition?.resolvedDependencies;
	if (
		statement._type !== "https://in-toto.io/Statement/v1" ||
		statement.predicateType !== slsa ||
		statement.subject?.length !== 1 ||
		statement.subject[0]?.name !== `pkg:npm/%40quotum/sdk@${expected.version}` ||
		statement.subject[0]?.digest?.sha512 !== expected.sha512 ||
		definition?.buildType !== buildType ||
		workflow?.repository !== repository ||
		workflow?.path !== ".github/workflows/release.yml" ||
		workflow?.ref !== ref ||
		!Array.isArray(dependencies) ||
		dependencies.length !== 1 ||
		dependencies[0]?.uri !== `git+${repository}@${ref}` ||
		dependencies[0]?.digest?.gitCommit !== expected.revision
	)
		throw new Error("Verified provenance does not match the tested tarball and source commit");
	return { repository, revision: expected.revision, identity };
}
