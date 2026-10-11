#!/usr/bin/env node
// Check the public documentation without making network requests or needing dependencies.
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const privateAsset = /(?:^|\/)(?:hypeman-demo|demo-poster)\.[^/]+$/i;

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

// Preserve line numbers while ignoring fenced examples, which are not rendered links.
function withoutFences(markdown) {
  let fence;
  return markdown.split("\n").map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && !fence) { fence = marker; return ""; }
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return "";
    }
    return line;
  }).join("\n");
}

function destination(value) {
  const trimmed = value.trimStart();
  if (trimmed.startsWith("<")) return trimmed.slice(1, trimmed.indexOf(">"));
  return /^(?:\\.|[^\s])+/.exec(trimmed)?.[0];
}

function links(markdown) {
  const found = [];
  // Read balanced parentheses so URLs with parentheses and nested linked images work.
  for (const match of markdown.matchAll(/\]\(/g)) {
    let depth = 1, end = match.index + 2;
    for (; end < markdown.length; end++) {
      if (markdown[end] === "\\") { end++; continue; }
      if (markdown[end] === "(") depth++;
      if (markdown[end] === ")" && --depth === 0) break;
    }
    if (depth === 0) found.push({ at: match.index, target: destination(markdown.slice(match.index + 2, end)) });
  }
  // Reference definitions, HTML media, and autolink URLs can also advertise files.
  for (const pattern of [
    /^\s{0,3}\[[^\]\n]+\]:\s*(<[^>]+>|\S+)/gm,
    /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,
    /<(https?:\/\/[^>]+)>/gi,
  ]) {
    for (const match of markdown.matchAll(pattern)) found.push({ at: match.index, target: destination(match[1]) });
  }
  return found;
}

const files = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => resolve(root, entry.name));
files.push(...await markdownFiles(resolve(root, "docs")), resolve(root, "scripts/art/README.md"));
let checked = 0;
for (const file of files.sort()) {
  const markdown = withoutFences(await readFile(file, "utf8"));
  for (const { at, target } of links(markdown)) {
    if (!target) continue;
    const location = `${relative(root, file)}:${markdown.slice(0, at).split("\n").length}`;
    let decoded;
    try { decoded = decodeURIComponent(target.replace(/\\([\\()\s])/g, "$1")); }
    catch { errors.push(`${location}: invalid URL encoding in ${target}`); continue; }
    const path = decoded.split(/[?#]/, 1)[0];
    if (privateAsset.test(path)) {
      errors.push(`${location}: launch-film assets must stay private: ${target}`);
      continue;
    }
    if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) continue;
    const absolute = path.startsWith("/") ? resolve(root, `.${path}`) : resolve(dirname(file), path);
    const local = relative(root, absolute);
    if (local === ".." || local.startsWith("../") || isAbsolute(local)) {
      errors.push(`${location}: link leaves the repository: ${target}`);
      continue;
    }
    try { await access(absolute); checked++; }
    catch { errors.push(`${location}: missing local target: ${target}`); }
  }
}

// The index is read only. Ignored, local production files are allowed; published film assets are not.
const tracked = spawnSync("git", ["ls-files", "--cached", "-z"], { cwd: root, encoding: "utf8" });
if (tracked.status === 0) {
  for (const path of tracked.stdout.split("\0").filter(Boolean)) {
    if (privateAsset.test(path)) errors.push(`${path}: launch-film assets must not be tracked or staged`);
  }
}

if (errors.length) {
  console.error(`Documentation check failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed: ${files.length} Markdown files, ${checked} local links; no published launch-film assets.`);
}
