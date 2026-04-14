import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip-micronaut-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Micronaut Plugin",
  description: "Empty Paperclip plugin scaffold for Micronaut workflows.",
  author: "Alvaro Sanchez-Mariscal",
  categories: ["automation"],
  capabilities: ["instance.settings.register"],
  instanceConfigSchema: {
    type: "object",
    properties: {}
  },
  entrypoints: {
    worker: "./dist/worker.js"
  }
};

export default manifest;
