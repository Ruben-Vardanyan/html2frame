// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// common.js — shared by the panel's pages (index.html, help.html, settings.html), loaded before their own script:
// the API helpers, the plugin manifest's path (copy, show in folder), Quit and the "html2frame has stopped"
// screen, and the dot that says an update is available (D21).
'use strict';

const $ = id => document.getElementById(id);

async function call(method, url, body) {
	const res = await fetch(url, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), {status: res.status, data});
	return data;
}

// follow a job: onEvent(ev) for log / progress; resolves with the result, rejects with the error
// ({cancelled: true} when it was cancelled)
function follow(id, onEvent) {
	return new Promise((resolve, reject) => {
		const es = new EventSource('/api/jobs/' + id + '/events');
		es.onmessage = m => {
			const ev = JSON.parse(m.data);
			if (ev.type === 'done') {
				es.close();
				resolve(ev.result);
			} else if (ev.type === 'error') {
				es.close();
				reject(new Error(ev.message));
			} else if (ev.type === 'cancelled') {
				es.close();
				reject(Object.assign(new Error('Cancelled'), {cancelled: true}));
			} else onEvent(ev);
		};
		es.onerror = () => {
			es.close();
			reject(new Error('Lost the connection to the panel server. Is it still running?'));
		};
	});
}

// a button says what happened for a moment, then shows its label again
function flash(btn, text) {
	const label = btn.textContent;
	btn.textContent = text;
	setTimeout(() => { btn.textContent = label; }, 1600);
}

// ---- the plugin's manifest path (Help and Settings) -------------------------------------------------
// <code id="manifestPath">, buttons #copyPath and #revealPath

function manifestBlock(manifest) {
	const code = $('manifestPath'), copy = $('copyPath'), reveal = $('revealPath');
	if (!code) return;
	if (!manifest) {
		copy.disabled = reveal.disabled = true;
		return;
	}
	code.textContent = manifest;
	copy.onclick = async () => {
		try {
			await navigator.clipboard.writeText(manifest);
			flash(copy, 'Copied');
		} catch (e) {
			// no clipboard access: select the path so Ctrl/⌘ + C works
			getSelection().selectAllChildren(code);
		}
	};
	reveal.onclick = async () => {
		const res = await fetch('/api/reveal-plugin', {method: 'POST'}).catch(() => null);
		if (!res || !res.ok) reveal.textContent = 'Could not open the folder';
		else flash(reveal, 'Opened');
	};
}

// ---- update dot --------------------------------------------------------------------------------------
// on the ☰ menu button, and on Settings in its dropdown (and on the Help page's Settings button)

function showUpdateDot(on) {
	for (const host of document.querySelectorAll('[data-update-dot]')) {
		let dot = host.querySelector('.dot');
		if (on && !dot) {
			dot = document.createElement('span');
			dot.className = 'dot';
			dot.setAttribute('role', 'img');
			dot.setAttribute('aria-label', 'Update available');
			dot.title = 'Update available';
			host.append(dot);
		} else if (!on && dot) dot.remove();
	}
}

// ---- Quit and "stopped" ------------------------------------------------------------------------------

// a page can add a warning to the question (the panel: unsaved changes)
let quitWarning = () => '';

async function quit() {
	const info = await call('GET', '/api/info').catch(() => null);
	if (!info) return showStopped();
	const job = info.running;
	const warn = [job ? job.title + ' is running; quitting stops it and saves nothing.' : '', quitWarning()].filter(Boolean).join(' ');
	if (!confirm(warn ? warn + '\n\nQuit html2frame anyway?' : 'Quit html2frame?\n\nThe panel and "Latest from panel" in Figma stop until you start html2frame again.')) return;
	const res = await fetch('/api/quit' + (job ? '?force=1' : ''), {method: 'POST'}).catch(() => null);
	// 404: a server started before Quit existed (it keeps running the old code until it is restarted)
	if (res && res.status === 404) return showStopped('old');
	if (channel) channel.postMessage('quit'); // the other panel tabs
	stoppedAndClose();
}

// every panel tab hears of a Quit in another one
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('html2frame') : null;
if (channel) channel.onmessage = e => { if (e.data === 'quit') stoppedAndClose(); };

// the "stopped" card, then the tab tries to close itself. Browsers allow that only for a tab that has shown one
// page (e.g. the one the Start file opened, before any link was followed); any other tab keeps the card, which
// says it can be closed.
function stoppedAndClose() {
	showStopped('quit');
	setTimeout(() => window.close(), 600);
}

const STOPPED = {
	quit: ['html2frame has stopped', 'You can close this tab. To start html2frame again: its icon, or the Start file in the html2frame folder ("Start (Windows)" or "Start (macOS)").'],
	gone: ['html2frame is not running', 'Start it again from its icon, or with the Start file in the html2frame folder ("Start (Windows)" or "Start (macOS)"), then reload this page.'],
	old: ['Restart html2frame', 'The html2frame that is running was started before its files changed, so it runs the old version and this page cannot work with it. Stop it (close its window, or press Ctrl+C in it), start it again with the Start file, then reload this page.'],
};

// the page's content gives way to one card: kind "quit" (after Quit), "gone" (the server does not answer) or
// "old" (an older server answers: the files changed while it ran). The theme switch stays.
function showStopped(kind = 'gone') {
	window.onbeforeunload = null;
	document.body.classList.add('stopped');
	const main = document.querySelector('main');
	main.replaceChildren();
	const card = document.createElement('section');
	card.className = 'card stopped-card';
	card.setAttribute('role', 'status');
	card.innerHTML = '<h1></h1><p class="muted"></p><button class="btn" type="button">Reload</button>';
	card.querySelector('h1').textContent = STOPPED[kind][0];
	card.querySelector('p').textContent = STOPPED[kind][1];
	card.querySelector('button').onclick = () => location.reload();
	main.append(card);
	card.querySelector('button').focus();
}

document.querySelectorAll('[data-quit]').forEach(b => b.addEventListener('click', quit));
