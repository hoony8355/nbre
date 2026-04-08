import { writeFileSync } from "node:fs";

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || "music-files",
};

const content = `window.APP_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
writeFileSync("config.local.js", content, "utf8");
console.log("config.local.js generated.");
