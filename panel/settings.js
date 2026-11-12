// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// settings.js — the Settings page (D21): version and the one-click update (follows the update job, then waits for
// html2frame to come back), the saved setup check and "Check again", the icons, the plugin's manifest path and Quit.
// $, call(), follow(), manifestBlock() and Quit come from common.js.
'use strict';

const when = iso => (iso ? new Date(iso).toLocaleString(undefined, {day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '');
const announce = text => { $('announce').textContent = text; };

function line(cls, text) {
	const p = $('lastUpdate');
	p.hidden = !text;
	p.className = cls;
	p.textContent = text || '';
}

// ---- render ------------------------------------------------------------------------------------------

function render(s) {
	const u = s.update;
	$('version').textContent = u.version;
	$('installKind').textContent = u.install === 'git' ? '· installed with git' : '· installed from a ZIP';
	const status = $('updateStatus');
	if (u.available) {
		status.className = 'ok';
		status.textContent = 'Version ' + u.latest + ' is available.';
	} else if (u.checkError) {
		status.className = 'warn-text';
		status.textContent = u.checkError;
	} else {
		status.className = 'muted';
		status.textContent = !u.lastCheck ? 'Not checked yet.' : u.noRelease ? 'No release has been published on GitHub yet (checked ' + when(u.lastCheck) + ').'
			: 'Up to date (checked ' + when(u.lastCheck) + ').';
	}
	// the release's notes: shown when there is something new, open while it waits to be installed
	const notes = u.release && u.release.notes && u.release.notes.trim();
	$('notesBox').hidden = !(u.available && u.release);
	if (u.available && u.release) {
		$('notesTitle').textContent = "What's new in " + u.latest + (u.release.published ? ' (' + when(u.release.published).split(',')[0] + ')' : '');
		$('notes').textContent = notes ? notes.replace(/^#+\s*/gm, '').replace(/^[*-]\s+/gm, '• ') : 'The release has no notes.';
		$('notesLink').href = u.release.url;
		$('notesBox').open = true;
	}
	if (u.error) line('bad', 'The update to ' + u.error.to + ' did not work (' + when(u.error.at) + '), so this version was kept: ' + u.error.message);
	else if (u.updated) line('ok', 'Updated from ' + u.updated.from + ' to ' + u.updated.to + ' on ' + when(u.updated.at) + '.');
	else line('', '');
	// a git folder updates itself only when that is safe (gitSafety in src/update.js); otherwise the command
	const gitBlocked = u.install === 'git' && u.git && u.git.ok === false;
	$('gitManual').hidden = !(u.available && gitBlocked);
	if (u.git) {
		$('gitReason').textContent = (u.git.reason || '') + ' To update, run this in a terminal:';
		$('gitCommand').textContent = u.git.command;
	}
	$('updateNow').hidden = !u.available || gitBlocked;
	$('updateNow').textContent = 'Update to ' + u.latest;

	renderCheck(s.check);
	renderIcons(s.icons);
	manifestBlock(s.pluginManifest);
	showOs(s.platform);
}

// "Show in Explorer" / "Show in Finder" / "Show in folder"
function showOs(platform) {
	const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'other';
	document.querySelectorAll('[data-os]').forEach(x => { x.hidden = x.dataset.os !== os; });
}

function renderCheck(check) {
	const list = $('checkList');
	list.replaceChildren();
	if (!check) {
		$('checkWhen').textContent = 'Not checked yet on this computer: click Check again.';
		return;
	}
	$('checkWhen').textContent = 'Checked ' + when(check.checkedAt) + (check.ok ? '. Everything html2frame needs is here.' : '.');
	for (const r of check.results) {
		const li = document.createElement('li');
		const mark = document.createElement('span');
		mark.className = r.ok ? 'ok' : 'bad';
		mark.textContent = (r.ok ? '✓ ' : '⚠ ') + r.label;
		li.append(mark, ': ' + r.detail);
		if (!r.ok && r.fix) {
			const fix = document.createElement('span');
			fix.className = 'fix';
			fix.textContent = r.fix;
			li.append(fix);
		}
		list.append(li);
	}
}

function renderIcons(icons) {
	$('iconsCard').hidden = !icons.supported;
	if (!icons.supported) return;
	const box = $('iconChecks');
	box.replaceChildren();
	for (const which of icons.order) {
		const label = document.createElement('label');
		label.className = 'check';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = !!icons.on[which];
		input.onchange = () => setIcon(which, input);
		label.append(input, icons.label[which]);
		box.append(label);
	}
}

// ---- actions -----------------------------------------------------------------------------------------

async function busyButton(btn, text, work) {
	const label = btn.textContent;
	btn.disabled = true;
	btn.textContent = text;
	try {
		return await work();
	} finally {
		btn.disabled = false;
		btn.textContent = label;
	}
}

async function setIcon(which, input) {
	$('iconsError').textContent = '';
	input.disabled = true;
	try {
		render(await call('POST', '/api/icons', {[which]: input.checked}));
		announce(input.checked ? 'Icon added.' : 'Icon removed.');
	} catch (e) {
		if (e.data && e.data.update) render(e.data);
		$('iconsError').textContent = e.message;
	} finally {
		input.disabled = false;
	}
}

$('checkAgain').onclick = () => busyButton($('checkAgain'), 'Checking…', async () => {
	try {
		const s = await call('POST', '/api/setup/check');
		render(s);
		const bad = s.check.results.filter(r => !r.ok).length;
		announce(bad ? bad + ' problem' + (bad === 1 ? '' : 's') + ' found.' : 'Everything html2frame needs is here.');
	} catch (e) {
		$('checkWhen').textContent = e.message;
	}
});

$('checkUpdates').onclick = () => busyButton($('checkUpdates'), 'Checking…', async () => {
	try {
		const s = await call('POST', '/api/update/check');
		render(s);
		announce($('updateStatus').textContent);
	} catch (e) {
		$('updateStatus').className = 'warn-text';
		$('updateStatus').textContent = e.message;
	}
});

$('copyCommand').onclick = async () => {
	try {
		await navigator.clipboard.writeText($('gitCommand').textContent);
		flash($('copyCommand'), 'Copied');
	} catch (e) {
		getSelection().selectAllChildren($('gitCommand'));
	}
};

$('showLog').onclick = () => call('POST', '/api/reveal-logs').catch(() => {});

// ---- update ------------------------------------------------------------------------------------------

function onUpdateEvent(ev) {
	if (ev.type === 'log') {
		$('updateLog').textContent += ev.text + '\n';
		$('updateLog').scrollTop = 1e9;
	}
	if (ev.type === 'progress') {
		$('updateBar').style.width = (ev.total ? Math.round(100 * ev.done / ev.total) : 50) + '%';
		$('updateJobText').textContent = ev.label;
	}
}

function showJob(on) {
	$('updateJob').hidden = !on;
	$('updateNow').disabled = $('checkUpdates').disabled = on;
	document.querySelectorAll('[data-quit]').forEach(b => { b.disabled = on; });
}

// the server quits and update.js starts it again (often within a second): wait for a server that started later
// than the one that ran the update
async function waitForRestart(started) {
	const until = Date.now() + 180000;
	while (Date.now() < until) {
		await new Promise(r => setTimeout(r, 1000));
		const info = await fetch('/api/info', {cache: 'no-store'}).then(r => (r.ok ? r.json() : null), () => null);
		if (info && info.started !== started) return true;
	}
	return false;
}

async function followUpdate(id) {
	showJob(true);
	const started = (await call('GET', '/api/info').catch(() => ({}))).started;
	try {
		const result = await follow(id, onUpdateEvent);
		$('updateBar').style.width = '100%';
		$('updateJobText').textContent = 'Installing ' + result.version + ' and starting html2frame again…';
		announce($('updateJobText').textContent);
		if (await waitForRestart(started)) return location.reload();
		$('updateSpinner').hidden = true;
		$('updateJobText').textContent = 'html2frame did not start again. Start it from its icon or the Start file; the log is in the .html2frame folder.';
	} catch (e) {
		showJob(false);
		$('updateJob').hidden = false;
		$('updateSpinner').hidden = true;
		$('updateJobText').textContent = e.cancelled ? 'Cancelled. Nothing was changed.' : e.message;
		announce($('updateJobText').textContent);
	}
}

$('updateNow').onclick = async () => {
	const to = $('updateNow').textContent.replace('Update to ', '');
	if (!confirm('Update html2frame to ' + to + '?\n\nhtml2frame stops for a moment and starts again with the new version. Your projects and captures stay as they are.')) return;
	$('updateLog').textContent = '';
	$('updateBar').style.width = '0';
	$('updateSpinner').hidden = false;
	$('updateJobText').textContent = 'Starting the update…';
	try {
		const {job} = await call('POST', '/api/update');
		await followUpdate(job);
	} catch (e) {
		$('updateJob').hidden = false;
		$('updateSpinner').hidden = true;
		$('updateJobText').textContent = e.message;
	}
};

// ---- start -------------------------------------------------------------------------------------------

showOs(/Mac/.test(navigator.platform || navigator.userAgent) ? 'darwin' : /Win/.test(navigator.platform || navigator.userAgent) ? 'win32' : 'other');

(async () => {
	let s;
	try {
		s = await call('GET', '/api/settings');
	} catch (e) {
		if (e.status === 404) return showStopped('old'); // a server started before the Settings page existed
		if (e.status) return ($('updateStatus').textContent = e.message); // the server answered, with an error
		return showStopped('gone');
	}
	render(s);
	if (s.running && s.running.kind === 'update') followUpdate(s.running.id); // the page was reloaded during an update
})();
