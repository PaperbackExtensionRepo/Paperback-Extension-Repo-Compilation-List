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
