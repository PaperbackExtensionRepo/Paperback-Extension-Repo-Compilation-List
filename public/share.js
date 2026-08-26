// Progressive enhancement for the share row. The network links are plain
// anchors that work with JS disabled; this only adds the two buttons that
// need scripting — the native share sheet and copy-to-clipboard.
(function () {
	var row = document.querySelector(".share-row");
	if (!row) return;

	var url = row.getAttribute("data-share-url") || location.href;
	var title = row.getAttribute("data-share-title") || document.title;

	var native = row.querySelector(".share-native");
	if (native && navigator.share) {
		// hidden by default: on a desktop browser with no share sheet the button
		// would do nothing at all
		native.hidden = false;
		native.addEventListener("click", function () {
			navigator.share({ title: title, url: url }).catch(function () {
				// the sheet was dismissed — nothing to report
			});
		});
	}

	var copy = row.querySelector(".share-copy");
	if (!copy) return;
	var label = copy.querySelector(".share-label");
	var original = label ? label.textContent : "";
	var reset;

	copy.addEventListener("click", function () {
		writeClipboard(url).then(function (ok) {
			if (!label) return;
			label.textContent = ok ? "Copied!" : "Press ⌘/Ctrl+C";
			copy.classList.toggle("share-copied", ok);
			clearTimeout(reset);
			reset = setTimeout(function () {
				label.textContent = original;
				copy.classList.remove("share-copied");
			}, 1800);
		});
	});

	function writeClipboard(text) {
		if (navigator.clipboard && window.isSecureContext) {
			return navigator.clipboard.writeText(text).then(function () {
				return true;
			}, legacyCopy);
		}
		return Promise.resolve(legacyCopy());
	}

	// Safari only exposes the async clipboard on https, so keep the old path
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
