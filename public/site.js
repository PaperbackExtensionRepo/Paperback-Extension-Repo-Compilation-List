// Homepage metadata polish.
(function () {
	var homepage = location.pathname === "/" || location.pathname === "/index.html";
	if (homepage) {
		var description =
			"Browse a compilation list of Paperback extension & source repositories for versions 0.8 and 0.9, with install links, included sources, and GitHub pages.";

		var metaDescription = document.querySelector('meta[name="description"]');
		if (metaDescription) metaDescription.setAttribute("content", description);

		var ogDescription = document.querySelector('meta[property="og:description"]');
		if (ogDescription) ogDescription.setAttribute("content", description);

		var mainDescription = document.querySelector(".main-description");
		if (mainDescription) {
			mainDescription.innerHTML =
				'Browse a compilation list of <a href="https://paperback.moe" target="_blank" rel="noopener">Paperback</a> extension &amp; source repositories for versions 0.8 and 0.9, with install links, included sources, and GitHub pages.';
		}

		// Prefer the scalable site mark over the old 32px ICO when crawlers and
		// browsers choose a favicon, while keeping the ICO as a compatibility fallback.
		var svgIcon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
		var firstIcon = document.querySelector('link[rel="icon"]');
		if (svgIcon) {
			svgIcon.setAttribute("href", "/favicon.svg");
			svgIcon.setAttribute("sizes", "any");
			if (firstIcon && firstIcon !== svgIcon) {
				document.head.insertBefore(svgIcon, firstIcon);
			}
		}
	}
})();

// Footer bar behaviour. Deliberately avoids "share"-flavoured class names and
// filenames: content blockers hide those as social widgets, which silently
// emptied the old share row.
(function () {
	var bar = document.querySelector(".site-bar");
	if (!bar) return;

	var url = bar.getAttribute("data-page-url") || location.href;
	var title = bar.getAttribute("data-page-title") || document.title;

	var send = bar.querySelector(".js-send");
	if (send && navigator.share) {
		// hidden by default: a browser with no share sheet would get a dead button
		send.hidden = false;
		send.addEventListener("click", function () {
			navigator.share({ title: title, url: url }).catch(function () {
				// sheet dismissed — nothing to report
			});
		});
	}

	var copy = bar.querySelector(".js-copy");
	if (!copy) return;
	var label = copy.querySelector(".bar-action-label");
	var original = label ? label.textContent : "";
	var reset;

	copy.addEventListener("click", function () {
		writeClipboard().then(function (ok) {
			if (!label) return;
			label.textContent = ok ? "Copied!" : "Press ⌘/Ctrl+C";
			copy.classList.toggle("is-copied", ok);
			clearTimeout(reset);
			reset = setTimeout(function () {
				label.textContent = original;
				copy.classList.remove("is-copied");
			}, 1800);
		});
	});

	function writeClipboard() {
		if (navigator.clipboard && window.isSecureContext) {
			return navigator.clipboard.writeText(url).then(function () {
				return true;
			}, legacyCopy);
		}
		return Promise.resolve(legacyCopy());
	}

	// Safari only exposes the async clipboard over https
	function legacyCopy() {
		try {
			var field = document.createElement("textarea");
			field.value = url;
			field.setAttribute("readonly", "");
			field.style.position = "fixed";
			field.style.top = "0";
			field.style.opacity = "0";
			document.body.appendChild(field);
			field.select();
			var ok = document.execCommand("copy");
			document.body.removeChild(field);
			return ok;
		} catch (error) {
			return false;
		}
	}
})();

// Slide-out menu. The markup is already in the page; this only wires up
// opening, closing and focus handling.
(function () {
	var toggle = document.querySelector(".drawer-toggle");
	var drawer = document.getElementById("site-drawer");
	var veil = document.querySelector(".drawer-veil");
	if (!toggle || !drawer || !veil) return;

	var closer = drawer.querySelector(".drawer-close");
	var lastFocused = null;

	function open() {
		lastFocused = document.activeElement;
		drawer.hidden = false;
		veil.hidden = false;
		// let the element lay out before animating, or the transition is skipped
		requestAnimationFrame(function () {
			document.body.classList.add("drawer-open");
			toggle.setAttribute("aria-expanded", "true");
		});
		if (closer) closer.focus();
		document.addEventListener("keydown", onKeydown);
	}

	function close() {
		document.body.classList.remove("drawer-open");
		toggle.setAttribute("aria-expanded", "false");
		document.removeEventListener("keydown", onKeydown);
		// keep it in the DOM until the slide-out finishes, then hide it from
		// assistive tech and tab order again
		window.setTimeout(function () {
			if (document.body.classList.contains("drawer-open")) return;
			drawer.hidden = true;
			veil.hidden = true;
		}, 260);
		if (lastFocused && lastFocused.focus) lastFocused.focus();
	}

	function onKeydown(event) {
		if (event.key === "Escape") close();
	}

	toggle.addEventListener("click", function () {
		if (document.body.classList.contains("drawer-open")) close();
		else open();
	});
	veil.addEventListener("click", close);
	if (closer) closer.addEventListener("click", close);

	// following a link should leave the menu shut behind you
	for (var i = 0; i < drawer.querySelectorAll(".drawer-item").length; i++) {
		drawer.querySelectorAll(".drawer-item")[i].addEventListener("click", close);
	}
})();
