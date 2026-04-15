import { createRequire } from "node:module";
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { MICRONAUT_PROJECT_DETAIL_TAB_ID } from "./micronaut.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: unknown };
const MANIFEST_VERSION =
  process.env.PLUGIN_VERSION?.trim() ||
  (typeof packageJson.version === "string" && packageJson.version.trim()) ||
  process.env.npm_package_version?.trim() ||
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

export default manifest;
