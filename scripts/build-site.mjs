#!/usr/bin/env node
// Generates public/repos.json from the tables in README.md.
// The README is the single source of truth for the site: add a row there and
// the next deploy picks it up.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

// pull a url out of a table cell: bare url, [text](url) or a bracketed [url]
function cellUrl(cell) {
	const md = cell.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
	if (md) return md[1];
	const bare = cell.match(/https?:\/\/[^\s\]|)]+/);
	return bare ? bare[0] : "";
}

function cleanName(cell) {
	return cell
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*`]/g, "")
		.trim();
}

// a table row is a data row when it has cells and isn't the |---|---| separator
function isSeparator(line) {
	return /^\|[\s:|-]+\|$/.test(line.trim());
}

const lines = readme.split("\n");
const repos = [];
let version = null;
let category = null;

for (const line of lines) {
	const heading = line.match(/^(#{1,6})\s+(.*)$/);
	if (heading) {
		const level = heading[1].length;
		const text = heading[2].trim();
		const versionMatch = text.match(/Paperback\s+(0\.\d)\s+Compatible/i);
		if (level === 1) {
			version = versionMatch ? versionMatch[1] : null;
			category = null;
		} else if (level >= 3) {
			category = text.replace(/[*`]/g, "").trim();
		}
		continue;
	}

	if (!version || !line.trim().startsWith("|") || isSeparator(line)) continue;

	const cells = line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((c) => c.trim());

	if (cells.length < 2) continue;

	const name = cleanName(cells[0]);
	if (!name || /^name$/i.test(name)) continue; // header row

	const install = cellUrl(cells[1] ?? "");
	const github = cellUrl(cells[2] ?? "");
	if (!install && !github) continue;

	repos.push({
		name: name.replace(/\s*\(0\.\d\)\s*$/, "").trim(),
		version,
		category: category || "Extensions",
		install,
		github,
	});
}

if (repos.length === 0) {
	console.error("No repos parsed from README.md — check the table format.");
	process.exit(1);
}

const out = {
	name: "Paperback Extension Repo",
	description: "Paperback Extension & Source Repo Compilation",
	updated: new Date().toISOString(),
	repos,
};

writeFileSync(join(root, "public", "repos.json"), `${JSON.stringify(out, null, "\t")}\n`);
console.log(`Wrote public/repos.json with ${repos.length} repos.`);
for (const r of repos) console.log(`  ${r.version}  ${r.name}`);
