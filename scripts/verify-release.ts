import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarballPath = process.argv[2];
if (!tarballPath) throw new Error("Usage: bun scripts/verify-release.ts <tested-tarball>");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const tarball = await readFile(resolve(tarballPath));
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
let published:
	| { dist: { integrity: string; tarball: string; attestations?: { url: string } } }
	| undefined;
for (let attempt = 0; attempt < 6; attempt++) {
	const response = await fetch("https://registry.npmjs.org/@quotum%2Fsdk", { redirect: "error" });
	if (response.ok) {
		const registry = await response.json();
		if (registry["dist-tags"]?.next === pkg.version && registry.versions?.[pkg.version]) {
			published = registry.versions[pkg.version];
			break;
		}
	}
	if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (!published || published.dist.integrity !== integrity)
	throw new Error("The next tag must contain the exact tested tarball");
if (!published.dist.attestations?.url)
	throw new Error("The public package has no provenance attestation");
const url = new URL(published.dist.tarball);
if (url.origin !== "https://registry.npmjs.org") throw new Error("Unexpected npm tarball origin");
const response = await fetch(url, { redirect: "error" });
if (
	!response.ok ||
	createHash("sha512")
		.update(new Uint8Array(await response.arrayBuffer()))
		.digest("base64") !== integrity.slice(7)
)
	throw new Error("The registry download differs from the tested tarball");

const work = await mkdtemp(join(tmpdir(), "quotum-published-"));
try {
	await writeFile(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));
	execFileSync(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--registry=https://registry.npmjs.org",
			`@quotum/sdk@${pkg.version}`,
		],
		{ cwd: work, stdio: "inherit" },
	);
	await writeFile(
		join(work, "smoke.mjs"),
		`import { createQuotum } from '@quotum/sdk';
const account = createQuotum({ baseUrl: 'https://example.test', apiKey: 'installation-smoke-only' }).account('smoke');
for (const method of ['consume', 'reserve', 'confirm', 'release', 'getReservation', 'getOperation']) {
 if (typeof account[method] !== 'function') throw new Error('Missing method: ' + method);
}
`,
	);
	execFileSync("node", ["smoke.mjs"], { cwd: work, stdio: "inherit" });
} finally {
	await rm(work, { recursive: true, force: true });
}
const report = {
	version: pkg.version,
	tag: "next",
	integrity,
	sha256: createHash("sha256").update(tarball).digest("hex"),
	provenance: published.dist.attestations.url,
};
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
await writeFile(
	new URL("../artifacts/publication.json", import.meta.url),
	`${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report)}\n`);
