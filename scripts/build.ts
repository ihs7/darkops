import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";

const outfile = "dist/cli.js";
await mkdir("dist", { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  target: "node",
  format: "esm",
  outdir: "dist",
  naming: "cli.js",
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const code = await readFile(outfile, "utf8");
if (!code.startsWith("#!")) {
  await writeFile(outfile, `#!/usr/bin/env node\n${code}`);
}
await chmod(outfile, 0o755);
console.log(`built ${outfile}`);
