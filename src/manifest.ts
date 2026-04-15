import { createRequire } from "node:module";
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { MICRONAUT_PROJECT_DETAIL_TAB_ID } from "./micronaut.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: unknown };

function normalizeManifestVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/^v(?=\d)/i, "");
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized) ? normalized : null;
}

const MANIFEST_VERSION =
  normalizeManifestVersion(process.env.PLUGIN_VERSION) ||
  normalizeManifestVersion(packageJson.version) ||
  normalizeManifestVersion(process.env.npm_package_version) ||
  "0.0.0-dev";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip-micronaut-plugin",
  apiVersion: 1,
  version: MANIFEST_VERSION,
  displayName: "Micronaut Plugin",
  description: "Micronaut release-branch dashboard and merge-up automation for Paperclip projects.",
  author: "Alvaro Sanchez-Mariscal",
  categories: ["automation"],
  capabilities: [
    "projects.read",
    "agents.read",
    "agents.invoke",
    "issues.read",
    "issues.create",
    "issues.update",
    "plugin.state.read",
    "plugin.state.write",
    "http.outbound",
    "ui.detailTab.register"
  ],
  ui: {
    slots: [
      {
        type: "detailTab",
        id: MICRONAUT_PROJECT_DETAIL_TAB_ID,
        displayName: "Micronaut branches",
        exportName: "MicronautProjectDetailTab",
        entityTypes: ["project"]
      }
    ]
  },
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  }
};

export { normalizeManifestVersion };
export default manifest;
