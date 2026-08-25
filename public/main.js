// renders the repo list from repos.json (generated from README.md at build time)

const GITHUB_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

const listEl = document.getElementById("repo-list");
const searchEl = document.getElementById("repo-search");
const versionEl = document.getElementById("version-select");
const categoryEl = document.getElementById("category-select");
const countEl = document.getElementById("total-count");

let repos = [];

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

function groupKey(repo) {
	return `Paperback ${repo.version} · ${repo.category}`;
}

function renderRepo(repo) {
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

	return `<li>
		<div class="repo-left">
			<div class="repo-title-row">
				<span class="repo-name">${escapeHtml(repo.name)}</span>
				<span class="repo-version-badge ${badgeClass}">${escapeHtml(repo.version)}</span>
			</div>
			<span class="repo-url">${escapeHtml(prettyUrl(primary))}</span>
		</div>
		<div class="repo-actions">${actions.join("")}</div>
	</li>`;
}

function render() {
	const query = (searchEl.value || "").trim().toLowerCase();
	const version = versionEl.value;
	const category = categoryEl.value;

	const filtered = repos.filter((repo) => {
		if (version && repo.version !== version) return false;
		if (category && repo.category !== category) return false;
		if (!query) return true;
		return `${repo.name} ${repo.install} ${repo.github} ${repo.category}`
			.toLowerCase()
			.includes(query);
	});

	countEl.textContent = filtered.length
		? `${filtered.length} repo${filtered.length === 1 ? "" : "s"}`
		: "";

	if (!filtered.length) {
		listEl.innerHTML = `<p class="empty-state">No repos match your filters.</p>`;
		return;
	}

	const groups = new Map();
	for (const repo of filtered) {
		const key = groupKey(repo);
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(repo);
	}

	listEl.innerHTML = [...groups.entries()]
		.map(
			([key, items]) => `<div class="group-header-row"><h2>${escapeHtml(key)}</h2></div>
			<ul>${items.map(renderRepo).join("")}</ul>`,
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

async function init() {
	try {
		const response = await fetch("repos.json", { cache: "no-cache" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		repos = data.repos || [];
	} catch (error) {
		listEl.innerHTML = `<p class="empty-state">Couldn't load the repo list. See it on <a href="https://github.com/PaperbackExtensionRepo/Paperback-Extension-Repo-Compilation-List">GitHub</a>.</p>`;
		console.error(error);
		return;
	}

	// 0.9 first, then 0.8, keeping README order inside each version
	repos.sort((a, b) => (a.version === b.version ? 0 : a.version > b.version ? -1 : 1));

	populateCategories();
	render();

	searchEl.addEventListener("input", render);
	versionEl.addEventListener("change", render);
	categoryEl.addEventListener("change", render);
}

init();
