#!/usr/bin/env node
// Generates public/repos.json from the tables in README.md, then enriches each
// repo with the sources it actually ships by fetching its versioning.json.
//
// The README stays the source of truth for which repos are listed; the source
// lists are pulled live at build time so they never go stale by hand.
//
// Repos that are unreachable, slow, or don't publish a versioning.json simply
// end up with no source list — the site degrades to a plain link for those.

import { createHash } from "node:crypto";
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
const ABOUT_PATH = "/about/";
const PAPERBACK_PATH = "/paperback/";

// Cache-buster derived from the asset contents. Hand-edited version strings
// went stale once already, and a browser holding the previous stylesheet
// renders the page with half its styling missing.
const ASSET_V = createHash("sha256")
	.update(readFileSync(join(root, "public", "styles.css")))
	.update(readFileSync(join(root, "public", "main.js")))
	.update(readFileSync(join(root, "public", "site.js")))
	.digest("hex")
	.slice(0, 10);

// One timestamp for the whole build, so the page, the about note and the
// sitemap's lastmod can't disagree with each other.
const BUILD_TIME = new Date();
const BUILD_ISO = BUILD_TIME.toISOString();
const BUILD_DAY = BUILD_ISO.slice(0, 10);
// CI exposes the commit being built; shown next to the date like a build id
const BUILD_SHA = (process.env.GITHUB_SHA || "").slice(0, 7);
// short form for the compact meta row above the list; the About page keeps
// the long form where there's room for it
const BUILD_SHORT = BUILD_TIME.toLocaleDateString("en-GB", {
	day: "numeric",
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});
const BUILD_READABLE = BUILD_TIME.toLocaleDateString("en-GB", {
	day: "numeric",
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
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
// Discord has no share-intent URL, so the button opens the server — paired with
// "Copy link" that's the actual way people share a link there
const PAPERBACK_DISCORD = "https://discord.paperback.moe/";
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

// Brand marks, rendered as inline SVG so they're crisp and actually
// recognisable — emoji stand-ins were not. Paths are the official simple-icons
// outlines; each was rendered and checked before being committed.
const BRAND = {
	github: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
	discord: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.6987.7719 1.3636 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>`,
	reddit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-6.991 4.87-3.86 0-6.99-2.176-6.99-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z"/></svg>`,
	x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>`,
};
const GITHUB_REPO_URL =
	"https://github.com/PaperbackExtensionRepo/Paperback-Extension-Repo-Compilation-List";
const PAPERBACK_REDDIT = "https://www.reddit.com/r/Paperback";
const PAPERBACK_X = "https://twitter.com/paperbackios";

// Structured data. Repo pages describe the repository as a SoftwareApplication
// so a crawler can tell one listing from another; guide pages describe themselves.
function jsonLdHtml(node) {
	return `<script type="application/ld+json">${JSON.stringify(node, null, "\t").replace(/</g, "\\u003c")}</script>`;
}

function repoJsonLd(repo) {
	const url = new URL(repo.page, SITE_URL).href;
	const node = {
		"@context": "https://schema.org",
		"@type": "SoftwareApplication",
		name: repo.name,
		url,
		applicationCategory: "BookApplication",
		operatingSystem: "iOS, iPadOS",
		softwareRequirements: `Paperback ${repo.version}`,
		isAccessibleForFree: true,
		offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
		mainEntityOfPage: { "@type": "WebPage", "@id": url },
		isPartOf: { "@id": `${SITE_URL}#website` },
	};
	if (repo.install) node.installUrl = repo.install;
	if (repo.github) node.codeRepository = repo.github;
	if (repo.sources.length) {
		node.description = `${repo.name} is a Paperback ${repo.version} extension repository with ${repo.sources.length} source${repo.sources.length === 1 ? "" : "s"}.`;
		node.featureList = repo.sources.map((source) => source.name);
	}
	return jsonLdHtml(node);
}

function guideJsonLd(title, description, path) {
	const url = new URL(path, SITE_URL).href;
	return jsonLdHtml({
		"@context": "https://schema.org",
		"@type": "WebPage",
		name: title,
		description,
		url,
		inLanguage: "en",
		isPartOf: { "@id": `${SITE_URL}#website` },
		dateModified: BUILD_DAY,
	});
}

// Slide-out navigation drawer, present on every page. Rendered in the markup
// rather than injected by JS so it still lists every page for a crawler, and
// so there's nothing to shift once scripts run.
function sidebarHtml(currentPath) {
	const item = (href, icon, label) => {
		const isCurrent = href === currentPath;
		return `<a class="drawer-item${isCurrent ? " is-current" : ""}" href="${href}"${isCurrent ? ' aria-current="page"' : ""}><span class="drawer-icon" aria-hidden="true">${icon}</span>${escapeHtml(label)}</a>`;
	};
	return `<button type="button" class="drawer-toggle" aria-controls="site-drawer" aria-expanded="false" aria-label="Open menu">
		<span class="drawer-bars" aria-hidden="true"><i></i><i></i><i></i></span>
	</button>
	<div class="drawer-veil" hidden></div>
	<aside id="site-drawer" class="drawer" hidden aria-label="Site menu">
		<div class="drawer-head">
			<span class="drawer-title">Paperback Extension Repo</span>
			<button type="button" class="drawer-close" aria-label="Close menu">✕</button>
		</div>
		<nav class="drawer-nav">
			${item("/", "🏠", "Main index")}
			${item(ABOUT_PATH, "🌸", "About")}
			${item(PAPERBACK_PATH, "📖", "What is Paperback?")}
			${item(PAPERBACK_09_PATH, "🎟️", "Get Paperback 0.9")}
			${item(APP_STORE_PATH, "🍎", "App Store")}
			${item(WORTH_KNOWING_PATH, "⚠️", "Worth knowing")}
			<p class="drawer-heading">Sections</p>
			<a class="drawer-item" href="/#version-0-9"><span class="drawer-icon" aria-hidden="true">💠</span>Paperback 0.9 Repos</a>
			<a class="drawer-item" href="/#version-0-8"><span class="drawer-icon" aria-hidden="true">🔮</span>Paperback 0.8 Repos</a>
			<a class="drawer-item" href="/#individual-repos"><span class="drawer-icon" aria-hidden="true">📚</span>Individual Repos</a>
			<p class="drawer-heading">Socials</p>
			<a class="drawer-item" href="${GITHUB_REPO_URL}" target="_blank" rel="noopener"><span class="drawer-icon brand-gh">${BRAND.github}</span>GitHub</a>
			<a class="drawer-item" href="${PAPERBACK_DISCORD}" target="_blank" rel="noopener"><span class="drawer-icon brand-dc">${BRAND.discord}</span>Discord</a>
			<a class="drawer-item" href="${PAPERBACK_REDDIT}" target="_blank" rel="noopener"><span class="drawer-icon brand-rd">${BRAND.reddit}</span>Reddit</a>
			<a class="drawer-item" href="${PAPERBACK_X}" target="_blank" rel="noopener"><span class="drawer-icon brand-x">${BRAND.x}</span>X</a>
		</nav>
	</aside>`;
}

// Footer bar, EverythingMoe-style: site name and page links on the left,
// community links on the right. Class names stay clear of "share"/"social"
// wording because content blockers hide those wholesale.
function siteBarHtml(title, path) {
	const url = new URL(path, SITE_URL).href;
	return `<footer class="site-bar" data-page-url="${escapeHtml(url)}" data-page-title="${escapeHtml(title)}">
		<div class="site-bar-inner">
			<div class="bar-brand">
				<a class="bar-name" href="#top">paperbackextensionrepo.xyz</a>
				<nav class="bar-links" aria-label="Site pages">
					<a href="${ABOUT_PATH}">About</a>
					<a href="${PAPERBACK_PATH}">Paperback</a>
					<a href="${PAPERBACK_09_PATH}">Get 0.9</a>
					<a href="/#individual-repos">Individual Repos</a>
					<a href="${WORTH_KNOWING_PATH}">Worth Knowing</a>
				</nav>
				<div class="bar-actions">
					<button type="button" class="bar-action js-send" hidden>
						<span class="bar-action-label">📤 Share</span>
					</button>
					<button type="button" class="bar-action js-copy">
						<span class="bar-action-label">🔗 Copy link</span>
					</button>
				</div>
			</div>
			<div class="bar-community">
				<span class="bar-label">Socials</span>
				<div class="bar-orbs">
					<a class="orb orb-gh" href="${GITHUB_REPO_URL}" target="_blank" rel="noopener" title="This project on GitHub" aria-label="This project on GitHub">${BRAND.github}</a>
					<a class="orb orb-dc" href="${PAPERBACK_DISCORD}" target="_blank" rel="noopener" title="Paperback Discord" aria-label="Paperback Discord">${BRAND.discord}</a>
					<a class="orb orb-rd" href="${PAPERBACK_REDDIT}" target="_blank" rel="noopener" title="r/Paperback on Reddit" aria-label="r/Paperback on Reddit">${BRAND.reddit}</a>
					<a class="orb orb-x" href="${PAPERBACK_X}" target="_blank" rel="noopener" title="Paperback on X" aria-label="Paperback on X">${BRAND.x}</a>
				</div>
			</div>
		</div>
		<p class="bar-stamp">
			Updated <time datetime="${BUILD_ISO}">${BUILD_SHORT}</time>${BUILD_SHA ? ` <span class="bar-sep">|</span> <code>${BUILD_SHA}</code>` : ""}
		</p>
	</footer>`;
}

const SITE_SCRIPT_HTML = `<script src="/site.js?v=${ASSET_V}" defer></script>`;

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

// Stamp the rebuild date into the page itself rather than rendering it from
// repos.json, so it is there for readers and crawlers with JS turned off.
const lastUpdatedPattern = /<!-- last-updated:start -->[\s\S]*?<!-- last-updated:end -->/;
if (!lastUpdatedPattern.test(homepageWithStaticRepoLinks)) {
	console.error("Last-updated markers are missing from public/index.html.");
	process.exit(1);
}
const homepageWithStamp = homepageWithStaticRepoLinks.replace(
	lastUpdatedPattern,
	`<!-- last-updated:start --><time datetime="${BUILD_ISO}">${BUILD_SHORT}</time><!-- last-updated:end -->`,
);
const homepageWithAssets = homepageWithStamp.replace(
	/(styles\.css|main\.js|site\.js)\?v=[^"']*/g,
	`$1?v=${ASSET_V}`,
);
writeFileSync(homepagePath, homepageWithAssets);
console.log(`Pre-rendered ${repos.length} internal repository links and stamped ${BUILD_DAY} in public/index.html.`);

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

function repoNeighbours(repo) {
	const peers = repos.filter((candidate) => candidate.version === repo.version);
	const index = peers.findIndex((candidate) => candidate.page === repo.page);

	if (index < 0 || peers.length < 2) {
		return { previous: null, next: null };
	}

	return {
		previous: peers[(index - 1 + peers.length) % peers.length],
		next: peers[(index + 1) % peers.length],
	};
}

function renderRepoPage(repo) {
	const canonical = new URL(repo.page, SITE_URL).href;
	// The heading already names the repo, so the buttons don't repeat it — they
	// stay short, verb-led and the same shape as each other. What the community
	// repo actually is belongs in prose, not squeezed into a button.
	const description =
		repo.name === INKDEX_REPO_NAME
			? `Install ${repo.name} for Paperback ${repo.version} and browse its included sources. It's a community repository — developers from many other repos contribute their sources here.`
			: `Install ${repo.name} for Paperback ${repo.version} and browse its included sources.`;
	const discordUrl = discordUrlForRepo(repo);
	const label = (text) => `${escapeHtml(text)} ${escapeHtml(repo.name)}`;
	const actions = [
		repo.install
			? `<a class="repo-add" href="${escapeHtml(repo.install)}" target="_blank" rel="noopener" aria-label="${label("Add to Paperback:")}">Add to Paperback</a>`
			: "",
		repo.name === INKDEX_REPO_NAME
			? `<a class="repo-community detail-community" href="${escapeHtml(repo.github)}" target="_blank" rel="noopener" aria-label="${label("Community repository:")}">🌐 Community repo</a>`
			: "",
		discordUrl
			? `<a class="repo-discord-link detail-discord" href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener" aria-label="${label(repo.version === "0.8" ? "Paperback 0.8 Discord support for" : "Discord support for")}">💬 ${repo.version === "0.8" ? "0.8 Discord" : "Discord support"}</a>`
			: "",
		repo.github
			? `<a class="detail-github" href="${escapeHtml(repo.github)}" target="_blank" rel="noopener" aria-label="${label("View on GitHub:")}">View on GitHub</a>`
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
	const { previous, next } = repoNeighbours(repo);
	const neighbourLinks =
		previous && next
			? `<nav class="repo-detail-card repo-neighbours" aria-labelledby="repo-neighbours-title">
				<h2 id="repo-neighbours-title">Explore more Paperback ${escapeHtml(repo.version)} repositories</h2>
				<div class="repo-neighbour-grid">
					<a class="repo-neighbour repo-neighbour-prev" href="${escapeHtml(previous.page)}">
						<span>← Previous repository</span>
						<strong>${escapeHtml(previous.name)}</strong>
					</a>
					<a class="repo-neighbour repo-neighbour-next" href="${escapeHtml(next.page)}">
						<span>Next repository →</span>
						<strong>${escapeHtml(next.name)}</strong>
					</a>
				</div>
			</nav>`
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
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="preload" href="/fonts/quicksand-latin.woff2" as="font" type="font/woff2" crossorigin />
		<link rel="stylesheet" href="/styles.css?v=${ASSET_V}" />
		${repoJsonLd(repo)}
	</head>
	<body class="repo-detail-page">
		${sidebarHtml(repo.page)}
		<header class="detail-header" id="top">
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
			${neighbourLinks}
			${DISCLAIMER_HTML}
		</main>
		${siteBarHtml(`${repo.name} — Paperback Extension Repo`, repo.page)}
		${SITE_SCRIPT_HTML}
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
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="preload" href="/fonts/quicksand-latin.woff2" as="font" type="font/woff2" crossorigin />
		<link rel="stylesheet" href="/styles.css?v=${ASSET_V}" />
		${guideJsonLd("Paperback 0.6 repositories and why they no longer work", description, WORTH_KNOWING_PATH)}
	</head>
	<body class="repo-detail-page">
		${sidebarHtml(WORTH_KNOWING_PATH)}
		<header class="detail-header" id="top">
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
		${siteBarHtml("Paperback 0.6 repos and why they don't work — Paperback Extension Repo", WORTH_KNOWING_PATH)}
		${SITE_SCRIPT_HTML}
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
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="preload" href="/fonts/quicksand-latin.woff2" as="font" type="font/woff2" crossorigin />
		<link rel="stylesheet" href="/styles.css?v=${ASSET_V}" />
		${guideJsonLd("How to get Paperback 0.9", description, PAPERBACK_09_PATH)}
	</head>
	<body class="repo-detail-page">
		${sidebarHtml(PAPERBACK_09_PATH)}
		<header class="detail-header" id="top">
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
		${siteBarHtml('How to get Paperback 0.9 — Paperback Extension Repo', PAPERBACK_09_PATH)}
		${SITE_SCRIPT_HTML}
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
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="preload" href="/fonts/quicksand-latin.woff2" as="font" type="font/woff2" crossorigin />
		<link rel="stylesheet" href="/styles.css?v=${ASSET_V}" />
		${guideJsonLd("Paperback on the App Store", description, APP_STORE_PATH)}
	</head>
	<body class="repo-detail-page">
		${sidebarHtml(APP_STORE_PATH)}
		<header class="detail-header" id="top">
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
		${siteBarHtml('Paperback on the App Store — Paperback Extension Repo', APP_STORE_PATH)}
		${SITE_SCRIPT_HTML}
	</body>
</html>
`;
}

// Shared <head> for the standalone guide pages — they only differ by title,
// description and canonical, and drifting apart is how a page loses its icon.
function pageHead(title, description, path) {
	const canonical = new URL(path, SITE_URL).href;
	const fullTitle = `${title} — Paperback Extension Repo`;
	return `<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width,initial-scale=1" />
		<meta name="color-scheme" content="light" />
		<meta name="theme-color" content="#fff5fa" />
		<meta name="description" content="${escapeHtml(description)}" />
		<title>${escapeHtml(fullTitle)}</title>
		<link rel="canonical" href="${escapeHtml(canonical)}" />
		<meta property="og:title" content="${escapeHtml(fullTitle)}" />
		<meta property="og:description" content="${escapeHtml(description)}" />
		<meta property="og:url" content="${escapeHtml(canonical)}" />
		<meta property="og:type" content="article" />
		<link rel="icon" href="/favicon.ico" sizes="32x32" />
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<link rel="preload" href="/fonts/quicksand-latin.woff2" as="font" type="font/woff2" crossorigin />
		<link rel="stylesheet" href="/styles.css?v=${ASSET_V}" />
		${guideJsonLd(title, description, path)}`;
}

function renderAboutPage() {
	const description =
		"How this Paperback repository directory is put together: which repos get listed, where each source list comes from, how often the site rebuilds, and who maintains it.";

	return `<!doctype html>
<html lang="en">
	<head>
		${pageHead("About this directory", description, ABOUT_PATH)}
	</head>
	<body class="repo-detail-page">
		${sidebarHtml(ABOUT_PATH)}
		<header class="detail-header" id="top">
			${SITE_LOGO_HTML}
			<span class="header-sparkle" aria-hidden="true">🌸 ✨ 🍡</span>
			<h1><span class="main-heading">About this directory</span></h1>
			<p class="main-description">${escapeHtml(description)}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>

			<section class="repo-detail-card">
				<h2>What this site is</h2>
				<p>
					Paperback Extension Repo is an independent, community-run index of
					extension repositories for the
					<a href="https://paperback.moe" target="_blank" rel="noopener">Paperback</a>
					reading app. It exists because these repositories are scattered
					across GitHub, Discord messages and forum posts, and there was no
					single place to see what exists and which Paperback version each one
					targets.
				</p>
				<p>
					The site hosts nothing itself. Every repository listed here belongs
					to the developer who built it, and installing one sends you straight
					to their own URL.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>How a repository gets listed</h2>
				<p>A repository is added when it meets all of these:</p>
				<ul class="about-list">
					<li>It is a genuine Paperback extension repository — it publishes a <code>versioning.json</code> manifest that the app can install from.</li>
					<li>It targets Paperback <strong>0.8</strong> or <strong>0.9</strong>. Repositories built for 0.6 and earlier are not listed as installable; the one that still shows up in search results is <a href="${WORTH_KNOWING_PATH}">documented separately</a> so people stop trying it.</li>
					<li>It is publicly reachable, without a login or paywall.</li>
					<li>Its developer publishes it for others to use.</li>
				</ul>
				<p>
					There is no ranking, no sponsorship and no paid placement. Ordering
					within each version section is simply the order repositories were
					added. Nobody pays to appear here and nothing is accepted in exchange
					for a listing.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>Where the source lists come from</h2>
				<p>
					The repository table lives in the project's
					<a href="https://github.com/PaperbackExtensionRepo/Paperback-Extension-Repo-Compilation-List/blob/main/README.md" target="_blank" rel="noopener">README on GitHub</a>,
					which is the single source of truth for what is listed. Everything
					else is generated from it.
				</p>
				<p>
					The list of sources shown under each repository is not typed by hand.
					On every build the site fetches each repository's own
					<code>versioning.json</code> and reads the sources, versions and
					content ratings straight out of it. That means a source list here can
					never be more than a day out of date with the repository it describes,
					and if a developer adds or removes a source it appears here on the
					next build without anyone editing this site.
				</p>
				<p>
					When a repository is unreachable at build time, its card says
					<em>"Source list unavailable"</em> rather than showing a stale list
					from an earlier build.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>How often it updates</h2>
				<p>
					The site rebuilds automatically once a day, and again whenever the
					repository list changes. Both the repository list and every source
					list are regenerated on each build.
				</p>
				<p class="about-stamp">
					Last rebuilt
					<time datetime="${BUILD_ISO}"><strong>${BUILD_READABLE}</strong></time>.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>Corrections and additions</h2>
				<p>
					If a repository is missing, listed under the wrong version, or has
					moved, please
					<a href="https://github.com/PaperbackExtensionRepo/Paperback-Extension-Repo-Compilation-List/issues" target="_blank" rel="noopener">open an issue</a>
					or
					<a href="https://github.com/PaperbackExtensionRepo/Paperback-Extension-Repo-Compilation-List" target="_blank" rel="noopener">send a pull request</a>
					— editing one row of the README is enough. Repository developers who
					would rather not be listed can ask and it will be removed.
				</p>
				<p>
					For help with an extension itself, contact its developer rather than
					this site: their GitHub link is on every card, and the Paperback
					Discord has an
					<a href="https://discord.com/channels/965890377896845352/1266865492455588000" target="_blank" rel="noopener">#other-repos</a>
					channel for repositories that aren't Inkdex's.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>Independence</h2>
				<p>
					This site is not affiliated with Paperback, with Inkdex, or with any
					of the repositories it lists. All names, trademarks and logos belong
					to their respective owners. It carries no advertising, no tracking
					scripts and no analytics — nothing you do here is recorded or sent
					anywhere.
				</p>
			</section>

			${DISCLAIMER_HTML}
		</main>
		${siteBarHtml("About the Paperback Extension Repo directory", ABOUT_PATH)}
		${SITE_SCRIPT_HTML}
	</body>
</html>
`;
}

function renderPaperbackPage() {
	const description =
		"What Paperback is, why it ships with no content of its own, the three types of extension it supports, and step-by-step instructions for installing an extension repository on both Paperback 0.9 and 0.8.";

	return `<!doctype html>
<html lang="en">
	<head>
		${pageHead("What is Paperback?", description, PAPERBACK_PATH)}
	</head>
	<body class="repo-detail-page">
		${sidebarHtml(PAPERBACK_PATH)}
		<header class="detail-header" id="top">
			${SITE_LOGO_HTML}
			<span class="header-sparkle" aria-hidden="true">📖 ✨ 🌸</span>
			<h1><span class="main-heading">What is Paperback?</span></h1>
			<p class="main-description">${escapeHtml(description)}</p>
		</header>
		<main>
			<a class="detail-back" href="/">← Back to all repositories</a>

			<section class="repo-detail-card">
				<h2>The app</h2>
				<p>
					Paperback is a modern, ad-free reading app for Apple devices. It
					offers a smooth, distraction-free experience with offline reading,
					iCloud sync and progress tracking.
				</p>
				<p>
					By default Paperback comes with <strong>no built-in content</strong>.
					To read anything you need to install <strong>extensions</strong>,
					which connect the app to reading sources. That is what the
					repositories on this site provide.
				</p>
				<p>
					🌐 The
					<a href="https://paperback.moe" target="_blank" rel="noopener">Paperback website</a>
					has installation instructions, FAQs and guides for the app itself.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>Extension types</h2>
				<p>Paperback supports three kinds of extension:</p>
				<ul class="about-list">
					<li><strong>📚 Content providing</strong> — adds readable chapters to the app.</li>
					<li><strong>📈 Tracking</strong> — syncs your progress with services like <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a> and <a href="https://www.goodreads.com" target="_blank" rel="noopener">Goodreads</a>.</li>
					<li><strong>📂 Collection management</strong> — syncs your library with external services such as <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a>.</li>
				</ul>
			</section>

			<section class="repo-detail-card">
				<h2>Installing extensions</h2>
				<h3>On Paperback 0.9</h3>
				<p>
					Tap <strong>Add to Paperback</strong> on any 0.9 repository on this
					site, or add it by hand:
				</p>
				<ol class="about-steps">
					<li>Open the Paperback app.</li>
					<li>Tap the cog to open <strong>Settings</strong>.</li>
					<li>Tap <strong>Extensions</strong>.</li>
					<li>Tap <strong>+</strong> and choose <strong>Source Repository</strong>.</li>
					<li>Paste the repository's base URL into the <strong>Repository Base URL</strong> field — for Inkdex that is <code>https://inkdex.github.io/extensions/0.9/stable</code>.</li>
				</ol>
				<h3>On Paperback 0.8</h3>
				<p>
					If you installed the app from the
					<a href="${APP_STORE_PATH}">App Store</a> you are most likely on
					0.8, so look through the <a href="/#version-0-8">0.8 repositories</a>
					for compatible extensions.
				</p>
				<p class="about-aside">
					Not sure which version you have? It is probably 0.8.
				</p>
				<p>
					There is a
					<a href="https://www.youtube.com/watch?v=GU9prPNmRt8" target="_blank" rel="noopener">video walkthrough for installing on 0.8</a>
					if you would rather watch someone do it.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>What's new in 0.9</h2>
				<h3>New features</h3>
				<ul class="about-list">
					<li>Novel support</li>
					<li>iCloud synchronisation</li>
					<li>Two-way tracker synchronisation</li>
				</ul>
				<h3>Improvements</h3>
				<ul class="about-list">
					<li>A modernised interface</li>
					<li>Improved usability</li>
					<li>Increased reliability</li>
					<li>Better performance</li>
				</ul>
				<p>
					0.9 is invite-only through TestFlight at the moment —
					<a href="${PAPERBACK_09_PATH}">here is how to request an invitation</a>.
					An App Store release date for 0.9 has not been announced, but a public
					release is expected in the coming months.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>Inkdex</h2>
				<p>
					Inkdex is a community-driven project that develops and maintains
					extensions for Paperback, covering manga, comics, light novels and
					more. It is the largest single repository listed on this site.
				</p>
				<p>
					🌐 The
					<a href="https://inkdex.github.io" target="_blank" rel="noopener">Inkdex website</a>
					has installation instructions, extension development documentation
					and an
					<a href="https://inkdex.github.io/faq" target="_blank" rel="noopener">FAQ page</a>
					that answers most 0.9 questions.
				</p>
			</section>

			<section class="repo-detail-card">
				<h2>Official links</h2>
				<h3>📕 Paperback</h3>
				<ul class="about-list">
					<li><a href="https://paperback.moe" target="_blank" rel="noopener">Website</a></li>
					<li><a href="https://github.com/Paperback-iOS" target="_blank" rel="noopener">GitHub</a></li>
					<li><a href="${PAPERBACK_DISCORD}" target="_blank" rel="noopener">Discord</a></li>
					<li><a href="https://twitter.com/paperbackios" target="_blank" rel="noopener">X (formerly Twitter)</a></li>
					<li><a href="https://www.reddit.com/r/Paperback" target="_blank" rel="noopener">Reddit</a> <span class="muted-note">(closed)</span></li>
				</ul>
				<h3>✏️ Inkdex</h3>
				<ul class="about-list">
					<li><a href="https://inkdex.github.io" target="_blank" rel="noopener">Website</a></li>
					<li><a href="https://github.com/inkdex" target="_blank" rel="noopener">GitHub</a></li>
				</ul>
			</section>

			${DISCLAIMER_HTML}
		</main>
		${siteBarHtml("What is Paperback? — Paperback Extension Repo", PAPERBACK_PATH)}
		${SITE_SCRIPT_HTML}
	</body>
</html>
`;
}

for (const [directoryName, html] of [
	["paperback-0-9", renderPaperback09Page()],
	["app-store", renderAppStorePage()],
	["about", renderAboutPage()],
	["paperback", renderPaperbackPage()],
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
	new URL(ABOUT_PATH, SITE_URL).href,
	new URL(PAPERBACK_PATH, SITE_URL).href,
	new URL(WORTH_KNOWING_PATH, SITE_URL).href,
	new URL(PAPERBACK_09_PATH, SITE_URL).href,
	new URL(APP_STORE_PATH, SITE_URL).href,
	...repos.map((repo) => new URL(repo.page, SITE_URL).href),
];
const sitemapEntries = sitemapUrls
	.map(
		(url) => `\t<url>
\t\t<loc>${escapeXml(url)}</loc>
\t\t<lastmod>${BUILD_DAY}</lastmod>
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
