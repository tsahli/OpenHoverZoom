import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const distDirectory = join(projectRoot, "dist");

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });

await cp(
  fileURLToPath(new URL("../static/", import.meta.url)),
  distDirectory,
  { recursive: true },
);

await cp(
  fileURLToPath(new URL("../src/content/content.css", import.meta.url)),
  join(distDirectory, "content.css"),
);

const shared = {
  bundle: true,
  legalComments: "none",
  minify: true,
  sourcemap: false,
  target: "chrome120",
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
};

await build({
  ...shared,
  entryPoints: [
    fileURLToPath(new URL("../src/content/index.ts", import.meta.url)),
  ],
  outfile: join(distDirectory, "content.js"),
  format: "iife",
});

await build({
  ...shared,
  entryPoints: {
    background: fileURLToPath(
      new URL("../src/background/index.ts", import.meta.url),
    ),
    popup: fileURLToPath(new URL("../src/popup/index.ts", import.meta.url)),
    options: fileURLToPath(new URL("../src/options/index.ts", import.meta.url)),
  },
  outdir: distDirectory,
  format: "esm",
});

console.log(`Built extension at ${distDirectory}`);
