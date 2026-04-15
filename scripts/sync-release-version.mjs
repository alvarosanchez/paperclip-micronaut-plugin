import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function resolveReleaseVersion(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const version = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  return SEMVER_PATTERN.test(version) ? version : null;
}

const input = process.argv[2] ?? process.env.RELEASE_TAG ?? process.env.PLUGIN_VERSION ?? "";
const version = resolveReleaseVersion(input);

if (!version) {
  console.error(
    `Expected a semver release tag or version, received ${JSON.stringify(input)}.`
  );
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(scriptDir, "..", "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

if (packageJson.version === version) {
  console.log(`package.json already uses version ${version}.`);
  process.exit(0);
}

packageJson.version = version;
await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
console.log(`Updated package.json version to ${version}.`);
