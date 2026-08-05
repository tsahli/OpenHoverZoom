import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const distDirectory = new URL("../dist/", import.meta.url).pathname;
const forbidden = [
  { label: "eval", pattern: /\beval\s*\(/u },
  { label: "new Function", pattern: /\bnew\s+Function\s*\(/u },
  { label: "userScripts API", pattern: /\buserScripts\b/u },
  { label: "remote script source", pattern: /<script[^>]+src=["']https?:/iu },
];

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await filesBelow(path)));
    else paths.push(path);
  }
  return paths;
}

const auditableExtensions = new Set([".js", ".json", ".html"]);
const violations = [];
for (const path of await filesBelow(distDirectory)) {
  if (!auditableExtensions.has(extname(path))) continue;
  const source = await readFile(path, "utf8");
  for (const check of forbidden) {
    if (check.pattern.test(source)) violations.push(`${check.label}: ${path}`);
  }
}

if (violations.length > 0) {
  throw new Error(`Forbidden bundle constructs found:\n${violations.join("\n")}`);
}

console.log("Bundle audit passed.");
