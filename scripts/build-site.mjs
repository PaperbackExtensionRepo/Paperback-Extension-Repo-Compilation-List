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
const WORTH_KNOWING_PATH = "/therobbiedavis/paperback-extension-repo/";
const PAPERBACK_09_PATH = "/paperback-0-9/";
const APP_STORE_PATH = "/app-store/";
const DISCLAIMER_HTML = `<aside class="site-disclaimer">
	<strong>Independent community directory.</strong>
	The extensions and repositories listed here are not affiliated with Paperback or the websites they support.
	All names, trademarks, and logos belong to their respective owners. This website only compiles links and
	does not own or maintain the linked repositories.
</aside>`;
const SITE_LOGO_HTML = `<img class="site-logo" src="/favicon.svg" alt="Paperback Extension Repo logo" width="96" height="96" />`;
const DISCORD_LINKS = {
	"Inkdex Extensions": "https://discord.gg/inkdex",
	"Kakarot Extensions": "https://discord.com/channels/965890377896845352/1367512880228077648/1429957780529221837",
	"Sinon's Extensions": "https://discord.com/channels/965890377896845352/1367512880228077648/1441074130089803810",
	"Pirate Vodka Extensions": "https://discord.com/channels/965890377896845352/1367512880228077648/1453690910352216064",
	"Nyzzik's Extensions": "https://discord.com/channels/965890377896845352/1367512880228077648/1484486345954037930",
	"PoppingMango Extensions": "https://discord.com/channels/965890377896845352/1367512880228077648/1524169221251272866",
	"Kittykatgit Extensions": "https://discord.com/channels/965890377896845352/1367512880228077648/1541405619100319836",
};
const SUPPORT_08_DISCORD =
	"https://discord.com/channels/965890377896845352/1266865492455588000";
const INKDEX_REPO_NAME = "Inkdex Extensions";

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

function discordUrlForRepo(repo) {
	if (repo.version === "0.8") return SUPPORT_08_DISCORD;
	return DISCORD_LINKS[repo.name] || "";
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
		// Optional 4th column. Some repos publish a friendly browse page at the
		// install link and keep versioning.json somewhere else; this lets the row
		// point people at the nice page while sources still come from the manifest.
		// Left empty, the install link doubles as the manifest, as it does for
		// almost every repo here.
		const manifest = cellUrl(cells[3] ?? "");
		if (!install && !github) continue;

		repos.push({
			name: name.replace(/\s*\(0\.\d\)\s*$/, "").trim(),
			version,
			category: category || "Extensions",
			install,
			github,
			manifest,
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
	// the manifest column wins when a row sets it, otherwise the install link is
	// assumed to be the repo root
	const source = repo.manifest || repo.install;
	if (!source) return { ok: false, reason: "no manifest or install url" };

	const root = source.replace(/\/+$/, "");
	let lastError = "unreachable";

	// an explicit manifest URL is exact — don't go guessing channel folders under it
	const candidates = repo.manifest ? [""] : FALLBACK_PATHS;

	for (const suffix of candidates) {
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

const homepagePath = join(root, "public", "index.html");
const homepage = readFileSync(homepagePath, "utf8");
const individualRepoLinksPattern =
	/<!-- individual-repo-links:start -->[\s\S]*?<!-- individual-repo-links:end -->/;
if (!individualRepoLinksPattern.test(homepage)) {
	console.error("Individual repository link markers are missing from public/index.html.");
	process.exit(1);
}
const individualRepoLinks = repos
	.map(
		(repo) => `\t\t\t\t\t<li>
\t\t\t\t\t\t<a href="${escapeHtml(repo.page)}">
\t\t\t\t\t\t\t<span>${escapeHtml(repo.name)}</span>
\t\t\t\t\t\t\t<span class="individual-repo-version">Paperback ${escapeHtml(repo.version)}</span>
\t\t\t\t\t\t</a>
\t\t\t\t\t</li>`,
	)
	.join("\n");
const homepageWithStaticRepoLinks = homepage.replace(
	individualRepoLinksPattern,
	`<!-- individual-repo-links:start -->
${individualRepoLinks}
\t\t\t\t\t\t<!-- individual-repo-links:end -->`,
);
writeFileSync(homepagePath, homepageWithStaticRepoLinks);
console.log(`Pre-rendered ${repos.length} internal repository links in public/index.html.`);

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
	const discordUrl = discordUrlForRepo(repo);
	const actions = [
		repo.install
			? `<a class="repo-add" href="${escapeHtml(repo.install)}" target="_blank" rel="noopener">Add ${escapeHtml(repo.name)} to Paperback</a>`
			: "",
		repo.name === INKDEX_REPO_NAME
			? `<a class="repo-community detail-community" href="${escapeHtml(repo.github)}" target="_blank" rel="noopener">🌐 Community extensions · many repo developers contribute here</a>`
			: "",
		discordUrl
			? `<a class="repo-discord-link detail-discord" href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener">💬 ${repo.version === "0.8" ? "Open Paperback 0.8 support on Discord" : "Open Discord support"}</a>`
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
	const sourcesAreScrollable = repo.sources.length > 8;
	const sourceGridClass = sourcesAreScrollable
		? "source-grid detail-source-grid source-grid-scrollable"
		: "source-grid detail-source-grid";
	const sourceGridAttributes = sourcesAreScrollable
		? ` tabindex="0" aria-label="${escapeHtml(repo.name)} sources — scroll for more"`
		: "";

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
		<link rel="stylesheet" href="/styles.css?v=20260826-community" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			${SITE_LOGO_HTML}
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
				<div class="${sourceGridClass}"${sourceGridAttributes}>${sourceCards}</div>
			</section>
			${DISCLAIMER_HTML}
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
		<link rel="stylesheet" href="/styles.css?v=20260826-community" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			${SITE_LOGO_HTML}
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
			${DISCLAIMER_HTML}
		</main>
	</body>
</html>
`;
}

const worthKnowingDirectory = join(root, "public", "therobbiedavis", "paperback-extension-repo");
rmSync(worthKnowingDirectory, { recursive: true, force: true });
mkdirSync(worthKnowingDirectory, { recursive: true });
writeFileSync(join(worthKnowingDirectory, "index.html"), renderWorthKnowingPage());

const oldWorthKnowingDirectory = join(root, "public", "worth-knowing");
rmSync(oldWorthKnowingDirectory, { recursive: true, force: true });
mkdirSync(oldWorthKnowingDirectory, { recursive: true });
writeFileSync(
	join(oldWorthKnowingDirectory, "index.html"),
	[
		"<!doctype html>",
		'<html lang="en">',
		"\t<head>",
		'\t\t<meta charset="UTF-8" />',
		'\t\t<meta name="robots" content="noindex" />',
		'\t\t<meta http-equiv="refresh" content="0; url=' + WORTH_KNOWING_PATH + '" />',
		'\t\t<link rel="canonical" href="' + new URL(WORTH_KNOWING_PATH, SITE_URL).href + '" />',
		"\t\t<title>Page moved</title>",
		"\t</head>",
		"\t<body>",
		'\t\t<p>This page moved to <a href="' + WORTH_KNOWING_PATH + '">therobbiedavis/paperback-extension-repo</a>.</p>',
		"\t</body>",
		"</html>",
	].join("\n"),
);
console.log("Wrote the Worth knowing page and legacy redirect.");

function renderPaperback09Page() {
	const canonical = new URL(PAPERBACK_09_PATH, SITE_URL).href;
	const description = "How to request access to Paperback 0.9 through TestFlight and configure the app.";

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
		<meta property="og:image" content="${SITE_URL}media/paperback-0-9/explore.webp" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet" />
		<link rel="stylesheet" href="/styles.css?v=20260826-community" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			${SITE_LOGO_HTML}
			<span class="header-sparkle" aria-hidden="true">🎟️ 🌸 ✨</span>
			<h1><span class="main-heading">How do I get Paperback 0.9?</span></h1>
			<p class="main-description">${description}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>
			<section class="repo-detail-card" id="invite-steps">
				<h2>Request a TestFlight invitation</h2>
				<p>Paperback 0.9 is currently distributed through an invite-only TestFlight.</p>
				<ol class="detail-steps">
					<li>Join the official <a href="https://discord.paperback.moe/" target="_blank" rel="noopener">Paperback Discord</a>.</li>
					<li>Become an active <a href="https://www.patreon.com/FaizanDurrani" target="_blank" rel="noopener">Patreon supporter</a> or boost the Discord server.</li>
					<li>Connect Discord in your <a href="https://www.patreon.com/settings/apps" target="_blank" rel="noopener">Patreon app settings</a>.</li>
					<li>Use <strong>Request TestFlight invitation</strong> in the <code>📨・testflight</code> Discord channel.</li>
				</ol>
				<p>Your email remains private. Prefer a walkthrough? Watch the <a href="https://youtu.be/JlawdANWYtw" target="_blank" rel="noopener">Paperback 0.9 TestFlight guide</a>.</p>
			</section>
			<section class="repo-detail-card">
				<h2>Device Support (0.9)</h2>
				<p>The latest Paperback version (v0.9) supports:</p>
				<ul class="compatibility-list">
					<li>iPhones running iOS 15.4 or later</li>
					<li>iPads running iPadOS 15.4 or later</li>
					<li>Macs running macOS 15.0 or later <span class="muted-note">(Intel-based Macs are not supported)</span></li>
				</ul>
			</section>
			<section class="repo-detail-card guide-gallery" aria-labelledby="paperback-preview-title">
				<h2 id="paperback-preview-title">A peek at Paperback 0.9</h2>
				<p class="gallery-intro">A cosy little tour of the redesigned browsing, reader, library, and updates experience. 🌸</p>
				<div class="guide-gallery-wide">
					<figure class="guide-image-card"><img src="/media/paperback-0-9/explore.webp" alt="Paperback 0.9 home screen with trending and popular titles" loading="lazy" /><figcaption>Explore favorites faster</figcaption></figure>
					<figure class="guide-image-card"><img src="/media/paperback-0-9/reader.webp" alt="Paperback 0.9 title details and chapter reader" loading="lazy" /><figcaption>A clean, focused reader</figcaption></figure>
					<figure class="guide-image-card"><img src="/media/paperback-0-9/devices.webp" alt="Paperback 0.9 displayed on a Mac, iPad, and iPhone" loading="lazy" /><figcaption>One library across your devices</figcaption></figure>
				</div>
				<div class="guide-gallery-portrait">
					<figure class="guide-image-card"><img src="/media/paperback-0-9/home.webp" alt="Paperback 0.9 home screen on iPhone" loading="lazy" /><figcaption>Home</figcaption></figure>
					<figure class="guide-image-card"><img src="/media/paperback-0-9/title.webp" alt="Paperback 0.9 title information screen" loading="lazy" /><figcaption>Title details</figcaption></figure>
					<figure class="guide-image-card"><img src="/media/paperback-0-9/updates.webp" alt="Paperback 0.9 chapter updates screen" loading="lazy" /><figcaption>Updates</figcaption></figure>
				</div>
			</section>
			<section class="repo-detail-card">
				<h2>Changing Content Settings</h2>
				<p>Paperback may hide titles or extensions according to your content permissions. If something expected is missing, update both the iOS permission and Paperback's filtering preferences:</p>
				<ol class="detail-steps">
					<li>Open the iOS <strong>Settings</strong> app.</li>
					<li>Scroll down and select <strong>Apps</strong>.</li>
					<li>Select <strong>Paperback</strong>.</li>
					<li>Enable <strong>Enable Content Settings</strong>.</li>
					<li>Open Paperback, then go to <strong>Settings → General Settings</strong>.</li>
					<li>Choose the level you prefer: <strong>Restricted</strong>, <strong>Mature</strong>, or <strong>Adult</strong>.</li>
				</ol>
				<figure class="content-settings-visual">
					<img src="/media/paperback-0-9/content-settings.webp" alt="iOS Paperback content permission and Paperback General Settings content filters" loading="lazy" />
					<figcaption>Enable the iOS permission first, then fine-tune filtering inside Paperback.</figcaption>
				</figure>
			</section>
			<section class="repo-detail-card">
				<h2>Notes</h2>
				<ul class="detail-notes">
					<li>Choosing <strong>Adult</strong> in the access portal lets you decide what appears in the app under <strong>Settings → General → Content Filtering</strong>.</li>
					<li>The portal setting also controls repository installation. <strong>Mature</strong> blocks repositories containing Adult extensions, while <strong>Restricted</strong> blocks repositories containing Mature or Adult extensions.</li>
				</ul>
			</section>
			<details class="repo-detail-card detail-faq">
				<summary><span>FAQ</span><span class="faq-hint">tap to open</span></summary>
				<div class="detail-faq-body">
					<dl class="faq-list">
						<dt>Is there a cooldown?</dt><dd>Yes. You must wait six hours between invitation attempts.</dd>
						<dt>I entered the wrong email. What now?</dt><dd>Wait six hours, then submit another invitation request with the correct email.</dd>
						<dt>Why did the invitation button fail?</dt><dd>Make sure your Discord username contains only letters and numbers.</dd>
						<dt>Why can't I type in <code>💙・supporter-chat</code>?</dt><dd>You may not have the required role yet. Recheck the <a href="#invite-steps">invitation steps above</a>.</dd>
						<dt>I didn't receive my invitation.</dt><dd>Review the guide above, then ask for help in <a href="https://discord.paperback.moe/" target="_blank" rel="noopener"><code>#support</code> on the Paperback Discord</a>.</dd>
						<dt>I didn't receive my supporter role.</dt><dd>Connect your Patreon membership to Discord in your <a href="https://www.patreon.com/settings/apps" target="_blank" rel="noopener">Patreon app settings</a>.</dd>
					</dl>
					<p class="guide-credit">Invitation FAQ information is credited to the official <a href="https://paperback.moe/" target="_blank" rel="noopener">Paperback website</a>.</p>
				</div>
			</details>
			${DISCLAIMER_HTML}
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
		<link rel="stylesheet" href="/styles.css?v=20260826-community" />
	</head>
	<body class="repo-detail-page">
		<header class="detail-header">
			${SITE_LOGO_HTML}
			<span class="header-sparkle" aria-hidden="true">📱 🌷 ✨</span>
			<h1><span class="main-heading">Paperback on the App Store</span></h1>
			<p class="main-description">${description}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>
			<section class="repo-detail-card">
				<h2>Paperback 0.8</h2>
				<p>The public App Store version is Paperback 0.8. It supports Paperback 0.8 extensions, but Paperback 0.9 extensions will not work in it.</p>
				<p><a class="repo-add" href="https://apps.apple.com/app/paperback-a-komga-client/id1626613373" target="_blank" rel="noopener">Download Paperback from the App Store</a></p>
				<p>Looking for the invite-only client? Read <a href="${PAPERBACK_09_PATH}">how to get Paperback 0.9</a>.</p>
			</section>
			<section class="repo-detail-card">
				<h2>Device Support (0.8)</h2>
				<p>The latest Paperback version (v0.8) supports:</p>
				<ul class="compatibility-list">
					<li>iPhones running iOS 13.4 or later</li>
					<li>iPads running iPadOS 13.4 or later</li>
					<li>Macs running macOS 11.0 or later <span class="muted-note">(Intel-based Macs are not supported)</span></li>
				</ul>
			</section>
			${DISCLAIMER_HTML}
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
