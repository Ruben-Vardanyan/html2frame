// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// about.js — the About page: the version, and "Report a problem", which opens GitHub's issue form
// (.github/ISSUE_TEMPLATE/bug_report.yml) with "Your setup" filled in from the setup check. Only what helps to find
// the problem goes in: versions of html2frame, the system, Node.js, the browsers. No folder paths (the check's
// folder line holds the user's name), no projects, no passwords.
'use strict';

const ISSUES = 'https://github.com/Ruben-Vardanyan/html2frame/issues/new';

// the browser the panel is shown in, e.g. "Microsoft Edge 142" (for problems in the panel itself)
function panelBrowser() {
	const brands = navigator.userAgentData && navigator.userAgentData.brands || [];
	const b = brands.find(x => !/Not.?A.?Brand|Chromium/i.test(x.brand)) || brands.find(x => /Chromium/i.test(x.brand));
	if (b) return b.brand + ' ' + b.version;
	const m = /(Firefox|Edg|Chrome|Version)\/([\d.]+)/.exec(navigator.userAgent);
	return m ? (m[1] === 'Edg' ? 'Microsoft Edge' : m[1] === 'Version' ? 'Safari' : m[1]) + ' ' + m[2] : 'unknown';
}

function setupText(s) {
	const lines = [];
	if (s) {
		lines.push('html2frame: ' + s.update.version + ' (' + (s.update.install === 'git' ? 'git' : 'ZIP') + ')');
		const check = s.check && s.check.results || [];
		for (const r of check) {
			if (/folder|^Port/i.test(r.label)) continue; // a path (with the user's name in it); the port says nothing new
			lines.push(r.label + ': ' + r.detail + (r.ok ? '' : ' (problem)'));
		}
		if (!check.length) lines.push('Setup check: not run yet');
	} else lines.push('html2frame: unknown (the panel server did not answer)');
	lines.push('Panel shown in: ' + panelBrowser());
	return lines.join('\n');
}

function show(s) {
	const text = setupText(s);
	$('setup').textContent = text;
	if (s) $('version').textContent = s.update.version;
	$('reportLink').href = ISSUES + '?template=bug_report.yml&environment=' + encodeURIComponent(text);
	$('ideaLink').href = ISSUES + '?template=idea.yml&environment=' + encodeURIComponent(text);
}

$('copySetup').onclick = async () => {
	try {
		await navigator.clipboard.writeText($('setup').textContent);
		flash($('copySetup'), 'Copied');
	} catch (e) {
		getSelection().selectAllChildren($('setup'));
	}
};

(async () => {
	show(null);
	try {
		show(await call('GET', '/api/settings'));
	} catch (e) {
		// an older server (no /api/settings): the links still work, with what the page knows
		const info = await call('GET', '/api/info').catch(() => null);
		if (info && info.version) $('version').textContent = info.version;
	}
})();
