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
