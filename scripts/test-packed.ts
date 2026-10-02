import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const tarball = resolve(process.argv[2] ?? "quotum-sdk-0.1.0-dev.0.tgz");
const work = await mkdtemp(join(tmpdir(), "quotum-packed-"));
const report: Record<string, unknown> = {
	sha256: createHash("sha256")
		.update(await readFile(tarball))
		.digest("hex"),
};
const run = (bin: string, args: string[]) =>
	execFileSync(bin, args, {
		cwd: work,
		encoding: "utf8",
		env: {
			...process.env,
			DENO_DIR: join(work, "deno-cache"),
			npm_config_cache: join(work, "npm-cache"),
		},
		timeout: 120_000,
	}).trim();
try {
	await writeFile(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));
	run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball]);
	const installed = join(work, "node_modules/@quotum/sdk");
	const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
	if (
		Object.keys(pkg.dependencies ?? {}).length ||
		Object.keys(pkg.exports).join() !== "." ||
		pkg.type !== "module"
	)
		throw new Error("Invalid package boundary");
	for (const name of await readdir(join(installed, "dist"))) {
		if (
			name.endsWith(".js") &&
			/(?:node:|process\.env|require\()/.test(await readFile(join(installed, "dist", name), "utf8"))
		)
			throw new Error(`Nonportable runtime dependency: ${name}`);
	}
	await cp(join(root, "tests/packed-scenarios.mjs"), join(work, "scenarios.mjs"));
	await writeFile(
		join(work, "run.mjs"),
		`import { createQuotum, QuotumAmbiguousOperationError } from '@quotum/sdk';\nimport { exercise } from './scenarios.mjs';\nconsole.log(JSON.stringify(await exercise(createQuotum, QuotumAmbiguousOperationError)));\n`,
	);
	report.node = {
		version: run("node", ["--version"]),
		result: JSON.parse(run("node", ["run.mjs"])),
	};
	if (process.argv.includes("--node-lts")) {
		for (const major of [22, 24]) {
			const args = ["--yes", `--package=node@${major}`, "node"];
			report[`node${major}`] = {
				version: run("npx", [...args, "--version"]),
				result: JSON.parse(run("npx", [...args, "run.mjs"])),
			};
		}
	}
	report.bun = { version: run("bun", ["--version"]), result: JSON.parse(run("bun", ["run.mjs"])) };
	report.deno = {
		version: run("deno", ["--version"]).split("\n")[0],
		result: JSON.parse(
			run("deno", ["run", "--node-modules-dir=manual", "--allow-read", "run.mjs"]),
		),
	};
	const declarations = (await readFile(join(root, "tests/types.ts"), "utf8")).replace(
		"../src/index.js",
		"@quotum/sdk",
	);
	await writeFile(join(work, "types.ts"), declarations);
	await writeFile(
		join(work, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				types: [],
			},
			files: ["types.ts"],
		}),
	);
	run(join(root, "node_modules/.bin/tsc"), ["-p", join(work, "tsconfig.json")]);
	report.typescript = "passed packed declarations and negative type assertions";
	await writeFile(
		join(work, "worker.mjs"),
		`import { createQuotum, QuotumAmbiguousOperationError } from '@quotum/sdk';\nimport { exercise } from './scenarios.mjs';\nexport default { async fetch() { return Response.json(await exercise(createQuotum, QuotumAmbiguousOperationError)); } };\n`,
	);
	const build = await Bun.build({
		entrypoints: [join(work, "worker.mjs")],
		target: "browser",
		minify: false,
	});
	if (!build.success || !build.outputs[0]) throw new Error("Packed Worker could not bundle");
	const compatibilityDate = "2026-07-30";
	const mf = new Miniflare({
		modules: true,
		script: await build.outputs[0].text(),
		compatibilityDate,
		compatibilityFlags: [],
	});
	try {
		const response = await mf.dispatchFetch("https://worker.test");
		if (!response.ok) throw new Error(`Worker failed: ${await response.text()}`);
		report.workers = { compatibilityDate, nodejsCompat: false, result: await response.json() };
	} finally {
		await mf.dispose();
	}
	await mkdir(join(root, "artifacts"), { recursive: true });
	await writeFile(
		join(root, "artifacts/packed-report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
	await rm(work, { recursive: true, force: true });
}
