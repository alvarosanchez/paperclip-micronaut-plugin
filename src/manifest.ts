import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip-micronaut-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Micronaut Plugin",
  description: "Project detail tab with Micronaut release, branch, and version metadata.",
  author: "Alvaro Sanchez-Mariscal",
  categories: ["automation"],
  capabilities: [
    "projects.read",
    "plugin.state.read",
    "plugin.state.write",
    "http.outbound",
    "ui.detailTab.register"
  ],
  ui: {
    slots: [
      {
        type: "detailTab",
        id: "micronaut-project-overview",
        displayName: "Micronaut",
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
