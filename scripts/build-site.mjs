#!/usr/bin/env node
// Generates public/repos.json from the tables in README.md, then enriches each
// repo with the sources it actually ships by fetching its versioning.json.
//
// The README stays the source of truth for which repos are listed; the source
// lists are pulled live at build time so they never go stale by hand.
//
// Repos that are unreachable, slow, or don't publish a versioning.json simply
// end up with no source list — the site degrades to a plain link for those.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

const FETCH_TIMEOUT_MS = Number(process.env.SOURCE_FETCH_TIMEOUT ?? 20000);
const CONCURRENCY = 6;
const SKIP_FETCH = process.env.SKIP_SOURCE_FETCH === "1";

/* ---------------------------------------------------------------- README -- */

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

function isSeparator(line) {
	return /^\|[\s:|-]+\|$/.test(line.trim());
}

function parseReadme(md) {
	const repos = [];
	let version = null;
	let category = null;

	for (const line of md.split("\n")) {
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

	return repos;
}

/* --------------------------------------------------------------- sources -- */

const RATING_LABELS = {
	EVERYONE: "Safe",
	SAFE: "Safe",
	MATURE: "Mature",
	ADULT: "18+",
	NSFW: "18+",
};

function normalizeRating(rating) {
	if (!rating) return "";
	return RATING_LABELS[String(rating).toUpperCase()] ?? "";
}

// 0.9 keeps the icon under <id>/static/, 0.8 under <id>/includes/
function iconUrl(base, source, isV9) {
	const icon = source.icon || "icon.png";
	if (/^https?:\/\//.test(icon)) return icon;
	const folder = isV9 ? "static" : "includes";
	return `${base}/${encodeURIComponent(source.id)}/${folder}/${icon}`;
}

function normalizeSources(manifest, base) {
	if (!manifest || !Array.isArray(manifest.sources)) return [];

	return manifest.sources
		.map((source) => {
			if (!source || !source.id) return null;
			// 0.9 sources carry `description`/`language`, 0.8 carry `desc`/`author`
			const isV9 = source.description !== undefined || source.language !== undefined;
			return {
				id: String(source.id),
				name: String(source.name || source.id),
				version: source.version ? String(source.version) : "",
				rating: normalizeRating(source.contentRating),
				website: source.websiteBaseURL || source.website || "",
				icon: iconUrl(base, source, isV9),
			};
		})
		.filter(Boolean)
		.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

async function fetchManifest(url) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		headers: { accept: "application/json", "user-agent": "paperback-repo-list-site" },
		redirect: "follow",
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.json();
}

// Some repos publish the manifest under a channel folder rather than at the
// root of the linked URL. If the root 404s, try the conventional layouts before
// giving up — costs nothing for the repos that resolve on the first try.
const FALLBACK_PATHS = ["", "0.9/stable", "0.8/stable", "stable", "0.9/test"];

async function loadSources(repo) {
	if (!repo.install) return { ok: false, reason: "no install url" };

	const root = repo.install.replace(/\/+$/, "");
	let lastError = "unreachable";

	for (const suffix of FALLBACK_PATHS) {
		const base = suffix ? `${root}/${suffix}` : root;
		// one retry — these are small static files, a single blip shouldn't drop a repo
		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				const manifest = await fetchManifest(`${base}/versioning.json`);
				const sources = normalizeSources(manifest, base);
				if (!sources.length) throw new Error("manifest had no sources");
				return { ok: true, sources, base };
			} catch (error) {
				lastError = error.message;
				// a 404 means "wrong path", so move on instead of retrying it
				if (/HTTP 404/.test(lastError)) break;
			}
		}
	}

	return { ok: false, reason: lastError };
}

// simple concurrency-limited map so we don't open 17 sockets at once
async function mapLimit(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	});
	await Promise.all(runners);
	return results;
}

/* ------------------------------------------------------------------ main -- */

const repos = parseReadme(readme);

if (repos.length === 0) {
	console.error("No repos parsed from README.md — check the table format.");
	process.exit(1);
}

console.log(`Parsed ${repos.length} repos from README.md`);

if (SKIP_FETCH) {
	console.log("SKIP_SOURCE_FETCH=1 — not fetching source lists.");
} else {
	console.log("Fetching source lists...");
	const outcomes = await mapLimit(repos, CONCURRENCY, async (repo) => {
		const result = await loadSources(repo);
		if (result.ok) {
			repo.sources = result.sources;
			console.log(`  ok    ${repo.name} — ${result.sources.length} sources`);
		} else {
			repo.sources = [];
			console.log(`  skip  ${repo.name} — ${result.reason}`);
		}
		return result;
	});

	const reached = outcomes.filter((r) => r.ok).length;
	const total = repos.reduce((sum, r) => sum + (r.sources?.length ?? 0), 0);
	console.log(`Reached ${reached}/${repos.length} repos, ${total} sources total.`);
}

for (const repo of repos) if (!repo.sources) repo.sources = [];

const out = {
	name: "Paperback Extension Repo",
	description: "Paperback Extension & Source Repo Compilation",
	updated: new Date().toISOString(),
	repos,
};

writeFileSync(join(root, "public", "repos.json"), `${JSON.stringify(out, null, "\t")}\n`);
console.log(`Wrote public/repos.json (${repos.length} repos).`);

/* ------------------------------------------------- sitemap + robots.txt -- */

const SITE_URL = "https://paperbackextensionrepo.xyz/";
const today = new Date().toISOString().slice(0, 10);

// single-page site, so the sitemap is one entry — lastmod moves with each build
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
	<url>
		<loc>${SITE_URL}</loc>
		<lastmod>${today}</lastmod>
		<changefreq>daily</changefreq>
		<priority>1.0</priority>
	</url>
</urlset>
`;
writeFileSync(join(root, "public", "sitemap.xml"), sitemap);

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}sitemap.xml
`;
writeFileSync(join(root, "public", "robots.txt"), robots);

console.log("Wrote public/sitemap.xml and public/robots.txt.");
