import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const build = resolve(root, "apps/extension/dist");
const release = resolve(root, "release");
const stage = resolve(release, "extension");
if (!stage.startsWith(release + (process.platform === "win32" ? "\\" : "/"))) throw new Error("Invalid staging directory");
const manifest = JSON.parse(await readFile(join(build, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.description.length > 132) throw new Error("Invalid store manifest");
if (!manifest.version || !manifest.icons?.[128]) throw new Error("Missing release metadata");
delete manifest.key; // Google assigns the store signing identity; retain the dev key in source/dist.
await mkdir(release, { recursive: true });
await rm(stage, { recursive: true, force: true });
await cp(build, stage, { recursive: true });
await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const files = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in release: ${path}`);
    if (entry.isDirectory()) await inspect(path);
    else {
      const name = relative(stage, path).replaceAll("\\", "/");
      if (/(?:^|\/)(?:\.env(?:\..*)?|\.hypeman-token.*|chatgpt-auth.*|chatgpt-host.*|messaging\.json.*|hypeman-demo\..*|demo-poster\..*)$|\.(?:map|pem|key|log)$/i.test(name))
        throw new Error(`Private/development artifact in release: ${name}`);
      files.push(name);
    }
  }
}
await inspect(stage);
for (const required of ["manifest.json", "background.js", "newtab.html", "newtab.js", "onboarding.html", "assets/audio/boombox.flac"])
  if (!files.includes(required)) throw new Error(`Missing extension file: ${required}`);
const zip = resolve(release, `hypeman-${manifest.version}-chrome-web-store.zip`);
await rm(zip, { force: true });
const result = process.platform === "win32"
  ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:HYPEMAN_RELEASE_STAGE, $env:HYPEMAN_RELEASE_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $false)"], {
    env: { ...process.env, HYPEMAN_RELEASE_STAGE: stage, HYPEMAN_RELEASE_ZIP: zip }, encoding: "utf8",
  })
  : spawnSync("zip", ["-q", "-r", zip, "."], { cwd: stage, encoding: "utf8" });
if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || "ZIP creation failed (requires PowerShell on Windows or zip on macOS/Linux)");
const bytes = await readFile(zip);
const metadata = { version: manifest.version, fileCount: files.length, zip: relative(root, zip).replaceAll("\\", "/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), developmentKeyRemoved: true, requiredGateway: "Node 24 local gateway for AI and phone features", files: files.sort() };
await writeFile(join(release, "package-report.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(`Store ZIP: ${zip}\n${files.length} files, ${(bytes.length / 1024 / 1024).toFixed(1)} MiB\nSHA-256: ${metadata.sha256}`);
