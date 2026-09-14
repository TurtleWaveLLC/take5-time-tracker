import { defineConfig } from "wxt";
import preact from "@preact/preset-vite";
import pkg from "./package.json";

export default defineConfig({
  srcDir: "src",

  vite: () => ({
    plugins: [preact()],
  }),

  manifest: ({ browser }) => ({
    name: "Take5 Time Tracker",
    version: pkg.version,
    description: "Track time spent on different domains",
    permissions: [
      "tabs",
      "storage",
      "activeTab",
      "webNavigation",
      "idle",
      "alarms",
      // User-initiated data export (saveAs dialog + completion tracking)
      "downloads",
      // Chrome only: offscreen document hosts createObjectURL for the MV3
      // service worker. Unknown to (and unneeded by) Firefox, whose
      // background page is a document already.
      ...(browser === "firefox" ? [] : ["offscreen"]),
    ],
    host_permissions: ["<all_urls>"],
    homepage_url: "https://github.com/JayDosunmu/take5-time-tracker",

    action: {
      default_title: "Web Time Tracker",
      default_icon: {
        16: "icon/icon-16.png",
        32: "icon/icon-32.png",
        48: "icon/icon-48.png",
      },
    },

    icons: {
      16: "icon/icon-16.png",
      32: "icon/icon-32.png",
      48: "icon/icon-48.png",
      128: "icon/icon-128.png",
    },

    browser_specific_settings: {
      gecko: {
        id: "time-tracker@heytakefive.com",
        strict_min_version: "109.0",
        // AMO handles updates for listed extensions
        // data_collection_permissions required for AMO submission
        data_collection_permissions: {
          required: ["none"],
        },
      } as Record<string, unknown>,
    },
  }),
});
