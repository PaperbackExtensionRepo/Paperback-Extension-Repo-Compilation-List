// Renders the repo list from repos.json (generated from README.md at build time,
// with each repo's source list pulled from its versioning.json).

const GITHUB_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

const CHEVRON = `<svg class="summary-chevron" viewBox="0 0 1024 1024" aria-hidden="true"><path fill="currentColor" d="M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.712a29.12 29.12 0 0 0 0-41.728 30.592 30.592 0 0 0-42.752 0z"/></svg>`;

const RATING_CLASS = {
	Safe: "rating-safe",
	Mature: "rating-mature",
	"18+": "rating-18",
};

const listEl = document.getElementById("repo-list");
const searchEl = document.getElementById("repo-search");
const versionEl = document.getElementById("version-select");
const categoryEl = document.getElementById("category-select");
const countEl = document.getElementById("total-count");
const individualRepoListEl = document.getElementById("individual-repo-list");

let repos = [];
// remember which cards the reader opened, so a re-render doesn't collapse them
const openRepos = new Set();

function prettyUrl(url) {
	return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function escapeHtml(str) {
	return String(str).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c],
	);
}

function repoKey(repo) {
	return `${repo.name}|${repo.version}`;
}

function renderSource(source, query) {
	const matched =
		query && source.name.toLowerCase().includes(query) ? " source-match" : "";
	const ratingClass = RATING_CLASS[source.rating] || "";
	const rating = source.rating
		? `<span class="source-rating ${ratingClass}">${escapeHtml(source.rating)}</span>`
		: "";
	const version = source.version ? `v${escapeHtml(source.version)}` : "";

	return `<div class="source-item${matched}">
		<img class="source-icon" src="${escapeHtml(source.icon)}" alt="" loading="lazy" decoding="async"
			onerror="this.style.visibility='hidden'" />
		<span class="source-text">
			<span class="source-name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
			<span class="source-meta">${version}${rating}</span>
		</span>
	</div>`;
}

function renderSourcesSection(repo, query, forceOpen) {
	const sources = repo.sources || [];
	if (!sources.length) {
		return `<p class="sources-none">Source list unavailable — open the repo to browse it.</p>`;
	}

	const isOpen = forceOpen || openRepos.has(repoKey(repo));
	const count = sources.length;
	const label = `${count} source${count === 1 ? "" : "s"}`;

	return `<details class="repo-sources" data-repo="${escapeHtml(repoKey(repo))}"${isOpen ? " open" : ""}>
		<summary>${CHEVRON}<span>🧁 ${label}</span><span class="summary-hint">tap to ${isOpen ? "hide" : "peek"}</span></summary>
		<div class="source-grid">${sources.map((s) => renderSource(s, query)).join("")}</div>
	</details>`;
}

function renderRepo(repo, query, forceOpen) {
	const badgeClass = repo.version === "0.9" ? "repo-version-09" : "repo-version-08";
	const primary = repo.install || repo.github;
	const actions = [];

	if (repo.install) {
		actions.push(
			`<a class="repo-add" href="${escapeHtml(repo.install)}" target="_blank" rel="noopener">Add to Paperback</a>`,
		);
	}
	if (repo.github) {
		actions.push(
			`<a class="repo-github" href="${escapeHtml(repo.github)}" target="_blank" rel="noopener" aria-label="${escapeHtml(repo.name)} on GitHub" title="View on GitHub">${GITHUB_ICON}</a>`,
		);
	}

	return `<li class="repo-card">
		<div class="repo-top">
			<div class="repo-left">
				<div class="repo-title-row">
					<span class="repo-name">${escapeHtml(repo.name)}</span>
					<span class="repo-version-badge ${badgeClass}">${escapeHtml(repo.version)}</span>
				</div>
				<span class="repo-url">${escapeHtml(prettyUrl(primary))}</span>
			</div>
			<div class="repo-actions">${actions.join("")}</div>
		</div>
		${renderSourcesSection(repo, query, forceOpen)}
	</li>`;
}

function matches(repo, query) {
	if (!query) return { hit: true, viaSource: false };

	const inRepo = `${repo.name} ${repo.install} ${repo.github} ${repo.category}`
		.toLowerCase()
		.includes(query);
	const viaSource = (repo.sources || []).some((s) =>
		s.name.toLowerCase().includes(query),
	);

	return { hit: inRepo || viaSource, viaSource };
}

function render() {
	const query = (searchEl.value || "").trim().toLowerCase();
	const version = versionEl.value;
	const category = categoryEl.value;

	const filtered = [];
	for (const repo of repos) {
		if (version && repo.version !== version) continue;
		if (category && repo.category !== category) continue;
		const { hit, viaSource } = matches(repo, query);
		if (hit) filtered.push({ repo, viaSource });
	}

	const sourceHits = filtered.reduce(
		(sum, { repo, viaSource }) =>
			sum +
			(viaSource
				? repo.sources.filter((s) => s.name.toLowerCase().includes(query)).length
				: 0),
		0,
	);

	countEl.textContent = filtered.length
		? `${filtered.length} repo${filtered.length === 1 ? "" : "s"}` +
			(sourceHits ? ` · ${sourceHits} matching source${sourceHits === 1 ? "" : "s"}` : "")
		: "";

	if (!filtered.length) {
		listEl.innerHTML = `<p class="empty-state"><span class="big">🍥</span>Nothing matched that — try another name?</p>`;
		return;
	}

	// grouped by Paperback version only — the category lives in the filter menu
	const groups = new Map();
	for (const entry of filtered) {
		const key = entry.repo.version;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(entry);
	}

	listEl.innerHTML = [...groups.entries()]
		.map(([version, entries]) => {
			const versionClass = version === "0.9" ? "group-09" : "group-08";
			const count = entries.length;
			return `<div class="group-header ${versionClass}">
				<h2 class="group-pill">Paperback ${escapeHtml(version)}</h2>
				<span class="group-count">${count} repo${count === 1 ? "" : "s"}</span>
			</div>
			<ul>${entries
				.map(({ repo, viaSource }) => renderRepo(repo, query, viaSource))
				.join("")}</ul>`;
		})
		.join("");
}

function renderIndividualRepoLinks() {
	if (!individualRepoListEl || individualRepoListEl.querySelector("a")) return;
	individualRepoListEl.innerHTML = repos
		.map(
			(repo) => `<li>
				<a href="${escapeHtml(repo.page)}">
					<span>${escapeHtml(repo.name)}</span>
					<span class="individual-repo-version">Paperback ${escapeHtml(repo.version)}</span>
				</a>
			</li>`,
		)
		.join("");
}

function populateCategories() {
	const categories = [...new Set(repos.map((r) => r.category))].sort();
	for (const category of categories) {
		const option = document.createElement("option");
		option.value = category;
		option.textContent = category;
		categoryEl.appendChild(option);
	}
}

// track open/closed state so filtering doesn't fight the reader
listEl.addEventListener("toggle", (event) => {
	const details = event.target;
	if (!details.matches(".repo-sources")) return;
	const key = details.dataset.repo;
	if (details.open) openRepos.add(key);
	else openRepos.delete(key);

	const hint = details.querySelector(".summary-hint");
	if (hint) hint.textContent = `tap to ${details.open ? "hide" : "peek"}`;
}, true);

function debounce(fn, ms) {
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
}

async function init() {
	try {
		const response = await fetch("repos.json", { cache: "no-cache" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		repos = (data.repos || []).map((r) => ({ ...r, sources: r.sources || [] }));
	} catch (error) {
		listEl.innerHTML = `<p class="empty-state"><span class="big">🥺</span>Couldn't load the repo list. See it on <a href="https://github.com/PaperbackExtensionRepo/Paperback-Extension-Repo-Compilation-List">GitHub</a>.</p>`;
		console.error(error);
		return;
	}

	// 0.9 first, then 0.8, keeping README order inside each version
	repos.sort((a, b) => (a.version === b.version ? 0 : a.version > b.version ? -1 : 1));

	populateCategories();
	renderIndividualRepoLinks();
	render();

	searchEl.addEventListener("input", debounce(render, 120));
	versionEl.addEventListener("change", render);
	categoryEl.addEventListener("change", render);
}

init();
