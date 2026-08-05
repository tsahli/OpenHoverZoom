import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const projectRoot = new URL("../", import.meta.url);
const distDirectory = new URL("../dist/", import.meta.url);

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });
await cp(new URL("../static/", import.meta.url), distDirectory, {
  recursive: true,
});
await cp(
  new URL("../src/content/content.css", import.meta.url),
  join(distDirectory.pathname, "content.css"),
);

const shared = {
  bundle: true,
  legalComments: "none",
  minify: false,
  sourcemap: false,
  target: "chrome120",
  tsconfig: new URL("../tsconfig.json", import.meta.url).pathname,
};

await build({
  ...shared,
  entryPoints: [new URL("../src/content/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/content.js", import.meta.url).pathname,
  format: "iife",
});

await build({
  ...shared,
  entryPoints: {
    background: new URL("../src/background/index.ts", import.meta.url).pathname,
    popup: new URL("../src/popup/index.ts", import.meta.url).pathname,
    options: new URL("../src/options/index.ts", import.meta.url).pathname,
  },
  outdir: distDirectory.pathname,
  format: "esm",
});

console.log(`Built extension at ${distDirectory.pathname}`);
