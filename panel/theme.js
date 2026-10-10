// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// theme.js — Light / Dark / System for the panel and the Help page. Loaded in <head> without defer, so the
// chosen theme is set before the page is drawn (no flash). panel.css reads <html data-theme="light|dark">;
// without it the system's setting applies. The choice is kept in this browser (localStorage).
(function () {
	'use strict';
	const KEY = 'h2f.theme';

	function get() {
		try {
			const t = localStorage.getItem(KEY);
			return t === 'light' || t === 'dark' ? t : 'system';
		} catch (e) {
			return 'system';
		}
	}

	function apply(t) {
		if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
		else delete document.documentElement.dataset.theme;
	}

	apply(get());

	document.addEventListener('DOMContentLoaded', () => {
		document.querySelectorAll('.theme-switch input').forEach(r => {
			r.checked = r.value === get();
			r.addEventListener('change', () => {
				try {
					localStorage.setItem(KEY, r.value);
				} catch (e) {}
				apply(r.value);
			});
		});
	});
	// another panel tab changed it
	window.addEventListener('storage', e => {
		if (e.key !== KEY) return;
		apply(get());
		document.querySelectorAll('.theme-switch input').forEach(r => { r.checked = r.value === get(); });
	});
})();
