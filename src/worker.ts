import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup() {}
});

export default plugin;
runWorker(plugin, import.meta.url);
