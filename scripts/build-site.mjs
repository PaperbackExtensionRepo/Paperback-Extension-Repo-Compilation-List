#!/usr/bin/env node
// Generates public/repos.json from the tables in README.md, then enriches each
// repo with the sources it actually ships by fetching its versioning.json.
//
// The README stays the source of truth for which repos are listed; the source
// lists are pulled live at build time so they never go stale by hand.
//
// Repos that are unreachable, slow, or don't publish a versioning.json simply
// end up with no source list — the site degrades to a plain link for those.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

const FETCH_TIMEOUT_MS = Number(process.env.SOURCE_FETCH_TIMEOUT ?? 20000);
const CONCURRENCY = 6;
const SKIP_FETCH = process.env.SKIP_SOURCE_FETCH === "1";
const SITE_URL = "https://paperbackextensionrepo.xyz/";
const WORTH_KNOWING_PATH = "/worth-knowing/";
const PAPERBACK_09_PATH = "/paperback-0-9/";
const APP_STORE_PATH = "/app-store/";

function escapeHtml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(character) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[character],
	);
}

function escapeXml(value) {
	return escapeHtml(value);
}

function repoSlug(repo) {
	return `${repo.name}-${repo.version}`
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

function repoPagePath(repo) {
	return `/repos/${repoSlug(repo)}/`;
}

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

for (const repo of repos) {
	if (!repo.sources) repo.sources = [];
	repo.page = repoPagePath(repo);
}

const out = {
	name: "Paperback Extension Repo",
	description: "Paperback Extension & Source Repo Compilation",
	updated: new Date().toISOString(),
	repos,
};

writeFileSync(join(root, "public", "repos.json"), `${JSON.stringify(out, null, "\t")}\n`);
console.log(`Wrote public/repos.json (${repos.length} repos).`);

/* ------------------------------------------------------- individual pages -- */

function renderSourceCard(source) {
	const meta = [
		source.version ? `v${escapeHtml(source.version)}` : "",
		source.rating ? escapeHtml(source.rating) : "",
	]
		.filter(Boolean)
		.join(" · ");
	const name = source.website
		? `<a class="source-name" href="${escapeHtml(source.website)}" target="_blank" rel="noopener">${escapeHtml(source.name)}</a>`
		: `<span class="source-name">${escapeHtml(source.name)}</span>`;

	return `<div class="source-item">
		<img class="source-icon" src="${escapeHtml(source.icon)}" alt="" loading="lazy" decoding="async" />
		<span class="source-text">
			${name}
			${meta ? `<span class="source-meta">${meta}</span>` : ""}
		</span>
	</div>`;
}

function renderRepoPage(repo) {
	const canonical = new URL(repo.page, SITE_URL).href;
	const description = `Install ${repo.name} for Paperback ${repo.version} and browse its included sources.`;
	const actions = [
		repo.install
			? `<a class="repo-add" href="${escapeHtml(repo.install)}" target="_blank" rel="noopener">Add ${escapeHtml(repo.name)} to Paperback</a>`
			: "",
		repo.github
			? `<a class="detail-github" href="${escapeHtml(repo.github)}" target="_blank" rel="noopener">View ${escapeHtml(repo.name)} on GitHub</a>`
			: "",
	]
		.filter(Boolean)
		.join("");
	const sourceCards = repo.sources.length
		? repo.sources.map(renderSourceCard).join("")
		: '<p class="sources-none detail-sources-none">The source list is currently unavailable. Use the repository links above to browse it.</p>';

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width,initial-scale=1" />
		<meta name="color-scheme" content="light" />
		<meta name="theme-color" content="#fff5fa" />
		<meta name="description" content="${escapeHtml(description)}" />
		<title>${escapeHtml(repo.name)} — Paperback Extension Repo</title>
		<link rel="canonical" href="${escapeHtml(canonical)}" />
		<meta property="og:title" content="${escapeHtml(repo.name)} — Paperback Extension Repo" />
		<meta property="og:description" content="${escapeHtml(description)}" />
		<meta property="og:url" content="${escapeHtml(canonical)}" />
		<meta property="og:type" content="website" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet" />
		<link rel="stylesheet" href="/styles.css" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			<span class="header-sparkle" aria-hidden="true">🌸 ✨ 🍡</span>
			<p class="detail-eyebrow">Paperback ${escapeHtml(repo.version)} · ${escapeHtml(repo.category)}</p>
			<h1><span class="main-heading">${escapeHtml(repo.name)}</span></h1>
			<p class="main-description">${escapeHtml(description)}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>
			<section class="repo-detail-card" aria-labelledby="repo-actions-title">
				<h2 id="repo-actions-title">Install or visit this repository</h2>
				<div class="detail-actions">${actions}</div>
			</section>
			<section class="repo-detail-card" aria-labelledby="repo-sources-title">
				<h2 id="repo-sources-title">Included sources</h2>
				<div class="source-grid detail-source-grid">${sourceCards}</div>
			</section>
		</main>
	</body>
</html>
`;
}

const repoPagesRoot = join(root, "public", "repos");
rmSync(repoPagesRoot, { recursive: true, force: true });
mkdirSync(repoPagesRoot, { recursive: true });

for (const repo of repos) {
	const pageDirectory = join(repoPagesRoot, repoSlug(repo));
	mkdirSync(pageDirectory, { recursive: true });
	writeFileSync(join(pageDirectory, "index.html"), renderRepoPage(repo));
}
console.log(`Wrote ${repos.length} individual repository pages.`);

function renderWorthKnowingPage() {
	const canonical = new URL(WORTH_KNOWING_PATH, SITE_URL).href;
	const description = "An outdated Paperback extension repository that should be skipped on current Paperback versions.";

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width,initial-scale=1" />
		<meta name="color-scheme" content="light" />
		<meta name="theme-color" content="#fff5fa" />
		<meta name="description" content="${description}" />
		<title>Worth knowing — Paperback Extension Repo</title>
		<link rel="canonical" href="${canonical}" />
		<meta property="og:title" content="Worth knowing — Paperback Extension Repo" />
		<meta property="og:description" content="${description}" />
		<meta property="og:url" content="${canonical}" />
		<meta property="og:type" content="website" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet" />
		<link rel="stylesheet" href="/styles.css" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			<span class="header-sparkle" aria-hidden="true">⚠️ 🌸 ⚠️</span>
			<h1><span class="main-heading">Worth knowing</span></h1>
			<p class="main-description">${description}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>
			<section class="repo-detail-card">
				<h2>Outdated Paperback 0.6 repository</h2>
				<p>
					<a href="https://github.com/therobbiedavis/paperback-extension-repo" target="_blank" rel="noopener">therobbiedavis/paperback-extension-repo</a>
					still turns up in searches, but it is built for Paperback 0.6 and
					will not install on Paperback 0.8 or 0.9. Skip this repository.
				</p>
			</section>
		</main>
	</body>
</html>
`;
}

const worthKnowingDirectory = join(root, "public", "worth-knowing");
rmSync(worthKnowingDirectory, { recursive: true, force: true });
mkdirSync(worthKnowingDirectory, { recursive: true });
writeFileSync(join(worthKnowingDirectory, "index.html"), renderWorthKnowingPage());
console.log("Wrote the Worth knowing page.");

function renderPaperback09Page() {
	const canonical = new URL(PAPERBACK_09_PATH, SITE_URL).href;
	const description = "How to request access to Paperback 0.9 through TestFlight.";

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width,initial-scale=1" />
		<meta name="color-scheme" content="light" />
		<meta name="theme-color" content="#fff5fa" />
		<meta name="description" content="${description}" />
		<title>How to get Paperback 0.9 — Paperback Extension Repo</title>
		<link rel="canonical" href="${canonical}" />
		<meta property="og:title" content="How to get Paperback 0.9" />
		<meta property="og:description" content="${description}" />
		<meta property="og:url" content="${canonical}" />
		<meta property="og:type" content="website" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet" />
		<link rel="stylesheet" href="/styles.css" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			<span class="header-sparkle" aria-hidden="true">🎟️ 🌸 ✨</span>
			<h1><span class="main-heading">How do I get Paperback 0.9?</span></h1>
			<p class="main-description">${description}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>
			<section class="repo-detail-card">
				<h2>Request a TestFlight invitation</h2>
				<p>Paperback 0.9 is invite-only through TestFlight for now.</p>
				<ol class="detail-steps">
					<li>Join the official <a href="https://discord.paperback.moe/" target="_blank" rel="noopener">Paperback Discord</a>.</li>
					<li>Become an active <a href="https://www.patreon.com/FaizanDurrani" target="_blank" rel="noopener">Patreon supporter</a> or a Discord server booster.</li>
					<li>Link your Discord account in your <a href="https://www.patreon.com/settings/apps" target="_blank" rel="noopener">Patreon app settings</a>.</li>
					<li>Select <strong>Request TestFlight invitation</strong> in the <code>📨・testflight</code> Discord channel.</li>
				</ol>
				<p>Your email stays private. You can also watch the <a href="https://youtu.be/JlawdANWYtw" target="_blank" rel="noopener">Paperback 0.9 TestFlight walkthrough</a>.</p>
			</section>
		</main>
	</body>
</html>
`;
}

function renderAppStorePage() {
	const canonical = new URL(APP_STORE_PATH, SITE_URL).href;
	const description = "Download Paperback from the App Store and understand its extension compatibility.";

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width,initial-scale=1" />
		<meta name="color-scheme" content="light" />
		<meta name="theme-color" content="#fff5fa" />
		<meta name="description" content="${description}" />
		<title>Paperback on the App Store — Paperback Extension Repo</title>
		<link rel="canonical" href="${canonical}" />
		<meta property="og:title" content="Paperback on the App Store" />
		<meta property="og:description" content="${description}" />
		<meta property="og:url" content="${canonical}" />
		<meta property="og:type" content="website" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet" />
		<link rel="stylesheet" href="/styles.css" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			<span class="header-sparkle" aria-hidden="true">📱 🌷 ✨</span>
			<h1><span class="main-heading">Paperback on the App Store</span></h1>
			<p class="main-description">${description}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>
			<section class="repo-detail-card">
				<h2>Paperback 0.8</h2>
				<p>
					The public App Store version is Paperback 0.8. It can use Paperback
					0.8 extensions, but Paperback 0.9 extensions will not work in it.
				</p>
				<p>
					<a class="repo-add" href="https://apps.apple.com/app/paperback-a-komga-client/id1626613373" target="_blank" rel="noopener">Download Paperback from the App Store</a>
				</p>
				<p>For the invite-only client, read <a href="${PAPERBACK_09_PATH}">how to get Paperback 0.9</a>.</p>
			</section>
		</main>
	</body>
</html>
`;
}

for (const [directoryName, html] of [
	["paperback-0-9", renderPaperback09Page()],
	["app-store", renderAppStorePage()],
]) {
	const directory = join(root, "public", directoryName);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "index.html"), html);
}
console.log("Wrote the Paperback 0.9 and App Store pages.");



/* ------------------------------------------------- sitemap + robots.txt -- */

const sitemapUrls = [
	SITE_URL,
	new URL(WORTH_KNOWING_PATH, SITE_URL).href,
	new URL(PAPERBACK_09_PATH, SITE_URL).href,
	new URL(APP_STORE_PATH, SITE_URL).href,
	...repos.map((repo) => new URL(repo.page, SITE_URL).href),
];
const sitemapEntries = sitemapUrls
	.map(
		(url) => `\t<url>
\t\t<loc>${escapeXml(url)}</loc>
\t</url>`,
	)
	.join("\n");

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</urlset>
`;
writeFileSync(join(root, "public", "sitemap.xml"), sitemap);

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}sitemap.xml
`;
writeFileSync(join(root, "public", "robots.txt"), robots);

console.log(`Wrote public/sitemap.xml with ${sitemapUrls.length} URLs and public/robots.txt.`);
