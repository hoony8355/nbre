import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const config = {
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || "music-files",
};

rmSync("public", { recursive: true, force: true });
mkdirSync("public", { recursive: true });

cpSync("index.html", "public/index.html");
cpSync("app.js", "public/app.js");
cpSync("styles.css", "public/styles.css");

const content = `window.APP_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
writeFileSync("public/config.local.js", content, "utf8");

console.log("public/ build output generated.");
