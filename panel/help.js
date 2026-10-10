// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// help.js — the Help page: Windows / macOS instructions, the plugin's manifest path (copy, show in folder).
'use strict';

const $ = id => document.getElementById(id);

function showOs(os) {
	document.querySelectorAll('[data-os]').forEach(x => { x.hidden = x.dataset.os !== os; });
	document.querySelectorAll('#osSwitch input').forEach(r => { r.checked = r.value === os; });
}

document.querySelectorAll('#osSwitch input').forEach(r => r.addEventListener('change', () => showOs(r.value)));
showOs(/Mac/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'win');

async function flash(btn, text) {
	const label = btn.textContent;
	btn.textContent = text;
	setTimeout(() => { btn.textContent = label; }, 1600);
}

let manifest = null;

$('copyPath').addEventListener('click', async () => {
	if (!manifest) return;
	try {
		await navigator.clipboard.writeText(manifest);
		flash($('copyPath'), 'Copied');
	} catch (e) {
		// no clipboard access: select the path so Ctrl/⌘ + C works
		getSelection().selectAllChildren($('manifestPath'));
	}
});

$('revealPath').addEventListener('click', async () => {
	const res = await fetch('/api/reveal-plugin', {method: 'POST'}).catch(() => null);
	if (!res || !res.ok) $('revealPath').textContent = 'Could not open the folder';
	else flash($('revealPath'), 'Opened');
});

(async () => {
	try {
		const info = await (await fetch('/api/info')).json();
		manifest = info.pluginManifest;
		$('manifestPath').textContent = manifest;
		if (info.platform === 'darwin') showOs('mac');
		else if (info.platform === 'win32') showOs('win');
		if (info.port !== 5600) {
			$('portWarning').hidden = false;
			$('portWarning').textContent = 'This panel runs on port ' + info.port + ', so the plugin cannot reach it: start it on 5600 (the default).';
		}
	} catch (e) {
		$('copyPath').disabled = $('revealPath').disabled = true;
	}
})();
