// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// panel.js — the control panel page (vanilla JS). Edits one project's settings (docs/PLAN.md "Settings file"):
// site and screens, optional sections that stay closed until used (languages and themes, test accounts, local
// storage, loading, replace text), and the pages in groups (drag to reorder, steps as rows). Runs "Find pages"
// (crawl) and "Capture" as server jobs, follows them over Server-Sent Events and can cancel them.
'use strict';

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') e.className = v;
		else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
		else if (v === true) e.setAttribute(k, '');
		else if (v !== false && v != null) e.setAttribute(k, v);
	}
	for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : String(k));
	return e;
};

// ---- "?" help marks ---------------------------------------------------------------------------------
// <span class="help" data-tip="…">?</span>: hover or keyboard focus shows the text in one shared tooltip.

function help(text) {
	return el('span', {class: 'help', tabindex: '0', role: 'img', 'aria-label': text, 'data-tip': text}, '?');
}

// the marks written in index.html carry only data-tip
document.querySelectorAll('.help[data-tip]').forEach(h => {
	h.tabIndex = 0;
	h.setAttribute('role', 'img');
	h.setAttribute('aria-label', h.dataset.tip);
});

const tip = el('div', {class: 'tip', role: 'tooltip'});
document.body.append(tip);

function showTip(t) {
	tip.textContent = t.dataset.tip;
	tip.classList.add('on');
	const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
	const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
	const y = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8; // above, or below near the top
	tip.style.left = x + 'px';
	tip.style.top = y + 'px';
}

function hideTip() {
	tip.classList.remove('on');
}

document.addEventListener('mouseover', e => {
	const t = e.target.closest('.help');
	if (t) showTip(t);
});
document.addEventListener('mouseout', e => {
	if (e.target.closest('.help')) hideTip();
});
document.addEventListener('focusin', e => {
	if (e.target.classList && e.target.classList.contains('help')) showTip(e.target);
});
document.addEventListener('focusout', hideTip);
window.addEventListener('scroll', hideTip, true);
// a "?" inside a <label> must not tick the checkbox or focus the field
document.addEventListener('click', e => {
	if (e.target.closest('.help')) e.preventDefault();
}, true);

// ---- dropdowns --------------------------------------------------------------------------------------
// Every choice list looks like the project picker: dropdown(select) hides a <select> and shows a button and
// a list in the panel's own style (the open list of a native <select> cannot be themed). The <select> stays
// the source of truth: it keeps the value and fires "change", so the code using it does not change.
// After changing a select's options or value from code, call syncDropdown(select).

const DD_CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5l3 3 3-3"/></svg>';
let closeDropdown = () => {}; // closes the one open list

function dropdown(sel, cls) {
	const text = el('span');
	const btn = el('button', {class: 'picker-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': sel.getAttribute('aria-label')}, text);
	btn.insertAdjacentHTML('beforeend', DD_CHEVRON);
	const wrap = el('span', {class: 'picker dd' + (cls ? ' ' + cls : '')}, btn);
	if (sel.parentNode) sel.replaceWith(wrap);
	sel.hidden = true;
	sel.tabIndex = -1;
	sel.setAttribute('aria-hidden', 'true');
	wrap.prepend(sel);
	let menu = null, active = -1;
	const sync = () => {
		const o = sel.options[sel.selectedIndex];
		text.textContent = o ? o.textContent : '';
		text.classList.toggle('none', !o);
	};
	const mark = () => {
		[...menu.children].forEach((li, i) => li.classList.toggle('active', i === active));
		if (menu.children[active]) menu.children[active].scrollIntoView({block: 'nearest'});
	};
	const close = () => {
		if (!menu) return;
		menu.remove();
		menu = null;
		btn.setAttribute('aria-expanded', 'false');
		closeDropdown = () => {};
	};
	const choose = i => {
		close();
		btn.focus();
		if (i < 0 || i === sel.selectedIndex) return;
		sel.selectedIndex = i;
		sync();
		sel.dispatchEvent(new Event('change', {bubbles: true}));
	};
	const open = () => {
		closeDropdown();
		if (!sel.options.length) return;
		menu = el('ul', {class: 'picker-menu dd-menu', role: 'listbox'});
		[...sel.options].forEach((o, i) => menu.append(el('li', {role: 'option', 'aria-selected': String(i === sel.selectedIndex), title: o.textContent, onclick: () => choose(i)}, o.textContent)));
		// in the page's top layer (a dialog's when inside one), placed by hand: a table or a card would clip it
		(sel.closest('dialog') || document.body).append(menu);
		const r = btn.getBoundingClientRect();
		menu.style.minWidth = r.width + 'px';
		const h = menu.offsetHeight, w = menu.offsetWidth;
		menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
		menu.style.top = (r.bottom + 4 + h > innerHeight - 8 && r.top - 4 - h >= 8 ? r.top - 4 - h : r.bottom + 4) + 'px';
		btn.setAttribute('aria-expanded', 'true');
		active = sel.selectedIndex;
		mark();
		closeDropdown = close;
	};
	btn.addEventListener('click', () => (menu ? close() : open()));
	btn.addEventListener('keydown', e => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (!menu) return open();
			active = Math.max(0, Math.min(menu.children.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
			mark();
		} else if ((e.key === 'Enter' || e.key === ' ') && menu) {
			e.preventDefault();
			choose(active);
		} else if (e.key === 'Escape' && menu) {
			e.preventDefault();
			e.stopPropagation(); // not the dialog around it
			close();
			btn.focus();
		} else if (e.key === 'Tab') close();
	});
	sel._sync = sync;
	sync();
	return wrap;
}

function syncDropdown(sel) {
	if (sel._sync) sel._sync();
}

document.addEventListener('click', e => {
	if (!e.target.closest('.dd, .dd-menu')) closeDropdown();
});
// the list is placed once, so it closes when what is under it moves (not when the list itself is scrolled)
window.addEventListener('scroll', e => {
	if (!(e.target.closest && e.target.closest('.dd-menu'))) closeDropdown();
}, true);
window.addEventListener('resize', () => closeDropdown());

let info = {presets: {}, examples: []};
let name = null; // current project file name
let project = null; // its settings
let dirty = false;
let busy = false;
let jobId = null; // the running job, for Cancel

// ---- server -----------------------------------------------------------------------------------------

async function call(method, url, body) {
	const res = await fetch(url, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || res.statusText);
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

function setBusy(b, text) {
	busy = b;
	$('busyChip').hidden = !b;
	$('busyText').textContent = text || 'Working…';
	// (while busy the picker cannot open, so its "+ New project" cannot be reached either)
	for (const id of ['findPages', 'captureBtn', 'projectSelect', 'projectBtn', 'deleteProject', 'removeAllCaptures']) $(id).disabled = b;
	showSaveState();
	// while a job runs the project cannot change: the cards, the page table and the Capture button are inert
	// (rows drawn later inherit it). Page search, the logs, Cancel and downloads stay usable.
	document.querySelectorAll('[data-lock]').forEach(x => { x.inert = b; });
	document.querySelectorAll('[data-test-login], [data-remove-capture]').forEach(x => { x.disabled = b; });
	if (!b) {
		jobId = null;
		$('crawlCancel').hidden = true;
		$('captureCancel').hidden = true;
	}
	if ($('allCaptures').open) renderAllCaptures();
}

// the Cancel button of the job that just started
function showCancel(button, id) {
	jobId = id;
	const b = $(button);
	b.hidden = false;
	b.disabled = false;
	b.textContent = 'Cancel';
}

// the job stops as soon as its browser closes and saves nothing; follow() then rejects with {cancelled: true}
async function cancelJob(e) {
	const b = e.currentTarget;
	if (!jobId) return;
	b.disabled = true;
	b.textContent = 'Cancelling…';
	try {
		await call('POST', '/api/jobs/' + jobId + '/cancel');
	} catch (err) {
		b.disabled = false;
		b.textContent = 'Cancel';
		alert('Could not cancel: ' + err.message);
	}
}

// ---- dirty / save -----------------------------------------------------------------------------------

// Save shows the state itself, no text beside it: quiet and disabled while everything is saved, filled in the
// warning colour while something is not (the title says which, also for screen readers).
function showSaveState() {
	const b = $('saveProject');
	b.classList.toggle('unsaved', dirty);
	b.title = dirty ? 'Unsaved changes: click to save' : 'All changes are saved';
	b.disabled = busy || !dirty;
}

function markDirty() {
	dirty = true;
	showSaveState();
	updateSummary();
}

async function save() {
	if (!project) return;
	// broken steps would be saved as the last valid version, losing what was typed: say so instead
	const problem = stepsProblem();
	if (problem) throw new Error(problem);
	await call('PUT', '/api/projects/' + encodeURIComponent(name), project);
	// a new name renames the project file too ("Insurance", not "Insurance (Fixture)")
	let notRenamed = null;
	if (project.name && project.name.trim() && project.name.trim() !== name) {
		try {
			const r = await call('POST', '/api/projects/' + encodeURIComponent(name) + '/rename', {to: project.name.trim()});
			if (r.name !== name) {
				name = r.name;
				localStorageSet('project', name);
				await refreshProjectList();
			}
		} catch (e) {
			notRenamed = e.message;
		}
	} else {
		await refreshProjectList();
	}
	dirty = false;
	showSaveState();
	// saved, but the file keeps its old name: there is no text beside Save any more, so say it here
	if (notRenamed) alert('Saved, but the project file was not renamed: ' + notRenamed);
}

// the dropdown, without reopening the current project
async function refreshProjectList() {
	const list = await call('GET', '/api/projects');
	const sel = $('projectSelect');
	sel.innerHTML = '';
	const titles = list.map(p => p.title);
	for (const p of list) sel.append(el('option', {value: p.name}, titles.filter(t => t === p.title).length > 1 ? p.title + ' (' + p.name + ')' : p.title));
	sel.value = name;
	renderPicker();
	return list;
}

// ---- project picker (button + list showing the hidden <select>) -------------------------------------

function renderPicker() {
	const sel = $('projectSelect');
	const current = sel.options[sel.selectedIndex];
	$('projectBtnText').textContent = current ? current.textContent : 'Choose a project';
	$('projectMenu').innerHTML = '';
	// the current project first, pinned to the top of the list (panel.css), then the others in their own order
	const item = (o, isCurrent) => el('li', {class: isCurrent ? 'picker-current' : '', role: 'option', 'aria-selected': String(isCurrent), 'data-value': o.value, title: o.textContent,
		onclick: () => choosePicker(o.value)}, o.textContent);
	if (current) $('projectMenu').append(item(current, true));
	[...sel.options].forEach(o => { if (o !== current) $('projectMenu').append(item(o, false)); });
	// "+ New project" is the list's last item, not a button beside Save (too easy to hit instead of it). It stays
	// pinned to the bottom of the list while the projects scroll (panel.css).
	$('projectMenu').append(el('li', {class: 'picker-new', role: 'option', 'aria-selected': 'false', 'data-action': 'new', onclick: newFromPicker}, 'New project'));
}

// what the arrow keys move through: the projects, then "+ New project"
function pickerItems() {
	return [...$('projectMenu').querySelectorAll('li[data-value], li[data-action]')];
}

function newFromPicker() {
	pickerOpen(false);
	showNewForm();
}

function pickerOpen(open) {
	const menu = $('projectMenu');
	menu.hidden = !open;
	$('projectBtn').setAttribute('aria-expanded', String(open));
	if (open) {
		const items = pickerItems();
		items.forEach(li => li.classList.toggle('active', li.getAttribute('aria-selected') === 'true'));
		const a = menu.querySelector('.active');
		if (a) a.scrollIntoView({block: 'nearest'});
	}
}

function choosePicker(value) {
	pickerOpen(false);
	$('projectBtn').focus();
	const sel = $('projectSelect');
	if (value === sel.value) return;
	sel.value = value;
	sel.dispatchEvent(new Event('change'));
	renderPicker();
}

$('projectBtn').addEventListener('click', () => pickerOpen($('projectMenu').hidden));
$('projectBtn').addEventListener('keydown', e => {
	const menu = $('projectMenu');
	const items = pickerItems();
	if (!items.length) return;
	let i = items.findIndex(li => li.classList.contains('active'));
	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
		e.preventDefault();
		if (menu.hidden) return pickerOpen(true);
		i = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
		items.forEach((li, k) => li.classList.toggle('active', k === i));
		items[i].scrollIntoView({block: 'nearest'});
	} else if ((e.key === 'Enter' || e.key === ' ') && !menu.hidden) {
		e.preventDefault();
		if (i >= 0) {
			if (items[i].dataset.action === 'new') newFromPicker();
			else choosePicker(items[i].dataset.value);
		}
	} else if (e.key === 'Escape' && !menu.hidden) {
		e.preventDefault();
		pickerOpen(false);
	}
});
document.addEventListener('click', e => {
	if (!e.target.closest('#projectPicker')) pickerOpen(false);
});

window.addEventListener('beforeunload', e => {
	if (dirty) {
		e.preventDefault();
		e.returnValue = '';
	}
});

// ---- projects ---------------------------------------------------------------------------------------

async function loadProjects(select) {
	const list = await refreshProjectList();
	const sel = $('projectSelect');
	sel.closest('.project-pick').hidden = !list.length;
	$('emptyState').hidden = list.length > 0;
	$('newForm').hidden = true; // e.g. after Cancel
	// the project asked for, else the one open last time, else the first; a remembered project that no longer
	// exists (deleted or renamed elsewhere) falls back to the first too, instead of an empty page
	let pick = select || localStorageGet('project');
	if (!pick || !list.some(p => p.name === pick)) pick = list[0] && list[0].name;
	if (pick && list.some(p => p.name === pick)) {
		sel.value = pick;
		renderPicker();
		await openProject(pick);
	} else {
		$('projectView').hidden = true;
	}
}

function localStorageGet(k) {
	try {
		return localStorage.getItem('h2f.' + k);
	} catch (e) {
		return null;
	}
}

function localStorageSet(k, v) {
	try {
		localStorage.setItem('h2f.' + k, v);
	} catch (e) {}
}

async function openProject(n) {
	project = await call('GET', '/api/projects/' + encodeURIComponent(n));
	name = n;
	dirty = false;
	localStorageSet('project', n);
	showSaveState();
	$('newForm').hidden = true;
	$('projectView').hidden = false;
	$('captureResult').hidden = true;
	inlineAdd = null;
	closeAddForm();
	openOptional();
	renderAll();
}

function renderAll() {
	renderProjectCard();
	renderScreens();
	renderDimensions();
	renderAccounts();
	renderStorage();
	renderReplace();
	renderWait();
	renderPages();
	renderCaptures();
	updateSummary();
}

// ---- 1. project card --------------------------------------------------------------------------------

function getPath(obj, p) {
	return p.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function setPath(obj, p, v) {
	const ks = p.split('.');
	let o = obj;
	for (const k of ks.slice(0, -1)) o = o[k] = o[k] || {};
	if (v === '' || v == null) delete o[ks[ks.length - 1]];
	else o[ks[ks.length - 1]] = v;
}

function renderProjectCard() {
	document.querySelectorAll('#projectView [data-bind]').forEach(input => {
		const v = getPath(project, input.dataset.bind);
		input.value = v == null ? '' : v;
		input.oninput = () => {
			setPath(project, input.dataset.bind, input.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value);
			markDirty();
		};
	});
	const kind = project.source && project.source.url ? 'url' : 'folder';
	document.querySelectorAll('input[name=kind]').forEach(r => {
		r.checked = r.value === kind;
		r.onchange = () => {
			showKind(r.value);
			// the project follows what is on screen: the other kind goes, this kind takes the text its field
			// still shows (a field keeps its text while hidden, so switching back must not leave it unsaved)
			project.source = project.source || {};
			delete project.source[r.value === 'url' ? 'folder' : 'url'];
			setPath(project, 'source.' + r.value, document.querySelector('#projectView [data-bind="source.' + r.value + '"]').value.trim());
			markDirty();
		};
	});
	showKind(kind);
}

// why Find pages / Capture cannot start, as a sentence; '' when the project has a usable site
function sourceProblem() {
	const s = (project && project.source) || {};
	if (!s.folder && !s.url) return 'Choose the site\'s folder or enter its address in step 1.';
	if (s.url && !/^https?:\/\/./i.test(s.url.trim())) return 'The address must start with http:// or https:// (e.g. http://localhost:3000).';
	return '';
}

function showKind(kind) {
	$('folderRow').hidden = kind !== 'folder';
	$('urlRow').hidden = kind !== 'url';
	// "include pages nothing links to" reads the folder's files; a running site does not tell which pages it
	// has, so for an address the box is off and its help says why
	const box = $('crawlUnlinked'), label = box.closest('label'), tip = label.querySelector('.help');
	if (!tip.dataset.folderTip) tip.dataset.folderTip = tip.dataset.tip;
	const text = kind === 'url' ? 'Only for a Folder site: html2frame then reads the folder\'s .html files. A running site (Address) does not tell which pages it has, so add pages nothing links to with "Add a page".' : tip.dataset.folderTip;
	tip.dataset.tip = text;
	tip.setAttribute('aria-label', text);
	box.disabled = kind === 'url';
	if (kind === 'url') box.checked = false;
	label.classList.toggle('off', kind === 'url');
}

// ---- 2. screens -------------------------------------------------------------------------------------

function renderScreens() {
	const chosen = new Set((project.screens || []).filter(s => typeof s === 'string').map(s => s.split(':')[0]));
	const box = $('screenPresets');
	box.innerHTML = '';
	for (const [key, p] of Object.entries(info.presets)) {
		const cb = el('input', {type: 'checkbox', value: key});
		cb.checked = chosen.has(key);
		cb.onchange = () => {
			const custom = (project.screens || []).filter(s => typeof s === 'object');
			const keys = [...box.querySelectorAll('input:checked')].map(x => x.value);
			project.screens = keys.concat(custom);
			markDirty();
			renderPages(); // the pages' screen choices follow the project's sizes
		};
		box.append(el('label', {class: 'screen'}, cb, el('span', {}, el('b', {}, p.label), el('small', {}, p.width + ' × ' + p.height + (p.mobile ? ' · touch' : '')))));
	}
	document.querySelectorAll('input[name=orient]').forEach(r => {
		r.checked = r.value === (project.orientation || 'portrait');
		r.onchange = () => {
			project.orientation = r.value;
			markDirty();
		};
	});
	renderCustomScreens();
}

function renderCustomScreens() {
	const box = $('customScreens');
	box.innerHTML = '';
	(project.screens || []).forEach((s, i) => {
		if (typeof s !== 'object') return;
		const upd = (k, v) => {
			s[k] = k === 'name' ? v : Number(v) || undefined;
			markDirty();
			if (k === 'name') {
				checkCustomScreens();
				renderPages(); // the pages' screen choices show the sizes by name
			}
		};
		box.append(el('div', {class: 'custom'},
			el('input', {value: s.name || '', placeholder: 'Name, e.g. Kiosk', 'aria-label': 'Name', oninput: e => upd('name', e.target.value)}),
			el('input', {type: 'number', min: 100, value: s.width || '', placeholder: 'Width', 'aria-label': 'Width (px)', title: 'Width (px)', oninput: e => upd('width', e.target.value)}),
			el('input', {type: 'number', min: 100, value: s.height || '', placeholder: 'Height', 'aria-label': 'Height (px)', title: 'Height (px)', oninput: e => upd('height', e.target.value)}),
			el('label', {class: 'check small'}, el('input', {type: 'checkbox', checked: !!s.mobile, onchange: e => { s.mobile = e.target.checked || undefined; markDirty(); }}), 'touch',
				help('Capture this size as a touch device (phone, tablet, touchscreen kiosk): the site sees a touch screen without a mouse and uses its mobile page settings, so touch-only designs appear. Leave it off for desktop and laptop sizes.')),
			el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove this size', onclick: () => { project.screens.splice(i, 1); markDirty(); renderCustomScreens(); renderPages(); }}, '×')));
	});
	checkCustomScreens();
}

// a custom size is told apart by its name (it becomes the screen's id), so two must not share one
function checkCustomScreens() {
	const ids = (project.screens || []).filter(s => typeof s === 'object').map(s => (s.name || 'custom').toLowerCase().replace(/\s+/g, '-'));
	const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
	$('customErr').hidden = !twice.length;
	$('customErr').textContent = twice.length ? 'Two custom sizes share the name "' + twice[0] + '". Give each its own name, or only one is told apart in Figma.' : '';
}

// ---- steps as rows ----------------------------------------------------------------------------------
// A list of steps (src/steps.js) shown as rows: an action, what it acts on and, for some, a second value.
// Steps the rows cannot show (an unknown action, extra properties) are edited as JSON instead, so opening
// a project never rewrites them.

// [key, label, placeholder, second key, second placeholder]
const STEP_KINDS = [
	['click', 'Click', 'what to click, e.g. #open-menu'],
	['fill', 'Type into', 'the field, e.g. #search', 'value', 'the text to type'],
	['select', 'Choose option', 'the list, e.g. #country', 'value', 'the option'],
	['check', 'Tick a box', 'the checkbox, e.g. #agree'],
	['press', 'Press a key', 'the key, e.g. Enter or Escape', 'on', 'in (optional), e.g. #search'],
	['hover', 'Hover over', 'what to hover, e.g. .menu'],
	['wait', 'Wait', 'milliseconds, e.g. 500'],
	['waitFor', 'Wait until visible', 'what must show, e.g. .dialog'],
	['waitForUrl', 'Wait for address', 'a part of the address, e.g. dashboard'],
	['goto', 'Go to address', '/page.html'],
	['reload', 'Reload the page'],
	['eval', 'Run script', 'JavaScript, e.g. openMenu()'],
];

function stepKindOf(s) {
	return s && typeof s === 'object' && !Array.isArray(s) ? STEP_KINDS.find(k => k[0] in s) : undefined;
}

// can the rows show these steps exactly as they are?
function stepsFit(steps) {
	return Array.isArray(steps) && steps.every(s => {
		const k = stepKindOf(s);
		return !!k && Object.keys(s).every(key => (key === k[0] || key === k[3]) && ['string', 'number', 'boolean'].includes(typeof s[key]));
	});
}

const STEP_UP = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5v-7M3 5.5l3-3 3 3"/></svg>';
const STEP_DOWN = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5v7M3 6.5l3 3 3-3"/></svg>';
const badSteps = new Map(); // a JSON steps box that does not parse -> label() saying whose steps they are

// why the project cannot be saved or run: a steps box holds broken JSON ('' when all are fine)
function stepsProblem() {
	for (const [box, label] of badSteps) {
		if (!box.isConnected) badSteps.delete(box);
		else return 'The steps of ' + label() + ' are not valid JSON. Fix them, or empty the box.';
	}
	return '';
}

// get(): the steps (a list, or nothing); set(list): stores them (an empty list too); label(): whose they are
function stepsEditor(get, set, label) {
	const box = el('div', {class: 'steps-editor'});
	let json = !stepsFit(get() || []);
	const draw = focusLast => {
		box.innerHTML = '';
		badSteps.delete(box);
		const steps = get() || [];
		if (json) {
			const ta = el('textarea', {rows: 6, spellcheck: 'false', placeholder: '[{"click": "#open-menu"}]'}, steps.length ? JSON.stringify(steps, null, '\t') : '');
			const err = el('div', {class: 'bad small'});
			ta.oninput = () => {
				try {
					const v = ta.value.trim() ? JSON.parse(ta.value) : [];
					if (!Array.isArray(v)) throw new Error('the steps must be a list: [ … ]');
					badSteps.delete(box);
					ta.classList.remove('invalid');
					err.textContent = '';
					set(v);
				} catch (e) {
					badSteps.set(box, label);
					ta.classList.add('invalid');
					err.textContent = 'Not valid JSON: ' + e.message;
				}
			};
			box.append(ta, err, el('div', {class: 'steps-foot'},
				el('button', {class: 'link', type: 'button', onclick: () => {
					if (badSteps.has(box)) return;
					if (!stepsFit(get() || [])) {
						err.textContent = 'These steps use something the list cannot show; keep editing them here.';
						return;
					}
					json = false;
					draw();
				}}, 'Edit as a list'),
				el('span', {class: 'muted small'}, 'goto, click, fill + value, select + value, check, press (+ on), hover, wait, waitFor, waitForUrl, eval, reload')));
			return;
		}
		const store = () => set(steps);
		steps.forEach((s, i) => {
			const k = stepKindOf(s);
			const kind = el('select', {'aria-label': 'Action', onchange: e => {
				const nk = STEP_KINDS.find(x => x[0] === e.target.value);
				const keep = k[0] === 'reload' ? '' : s[k[0]];
				const n = {[nk[0]]: nk[0] === 'reload' ? true : nk[0] === 'wait' ? Number(keep) || 500 : String(keep ?? '')};
				if (nk[3] === 'value') n.value = k[3] === 'value' ? String(s.value ?? '') : '';
				steps[i] = n;
				store();
				draw();
			}}, STEP_KINDS.map(x => el('option', {value: x[0]}, x[1])));
			kind.value = k[0];
			const row = el('div', {class: 'step'}, el('span', {class: 'step-n'}, i + 1), dropdown(kind));
			if (k[0] === 'reload') row.append(el('span', {style: 'grid-column: span 2'}));
			else {
				const main = el('input', {value: String(s[k[0]] ?? ''), placeholder: k[2], 'aria-label': k[1], spellcheck: 'false', autocomplete: 'off',
					type: k[0] === 'wait' ? 'number' : 'text', min: k[0] === 'wait' ? 0 : null,
					oninput: e => { s[k[0]] = k[0] === 'wait' ? Number(e.target.value) || 0 : e.target.value; store(); }});
				if (!k[3]) main.style.gridColumn = 'span 2';
				row.append(main);
				if (k[3]) {
					row.append(el('input', {value: String(s[k[3]] ?? ''), placeholder: k[4], 'aria-label': k[4], spellcheck: 'false', autocomplete: 'off', oninput: e => {
						if (k[3] === 'on' && !e.target.value) delete s.on; else s[k[3]] = e.target.value;
						store();
					}}));
				}
			}
			const swap = j => { [steps[i], steps[j]] = [steps[j], steps[i]]; store(); draw(); };
			const up = el('button', {class: 'icon-btn', type: 'button', title: 'Earlier', 'aria-label': 'Earlier', disabled: i === 0, onclick: () => swap(i - 1)});
			const down = el('button', {class: 'icon-btn', type: 'button', title: 'Later', 'aria-label': 'Later', disabled: i === steps.length - 1, onclick: () => swap(i + 1)});
			up.innerHTML = STEP_UP;
			down.innerHTML = STEP_DOWN;
			row.append(el('span', {class: 'step-btns'}, up, down,
				el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove this step', onclick: () => { steps.splice(i, 1); store(); draw(); }}, '×')));
			box.append(row);
		});
		box.append(el('div', {class: 'steps-foot'},
			el('button', {class: 'link', type: 'button', onclick: () => { steps.push({click: ''}); store(); draw(true); }}, '+ Add a step'),
			el('button', {class: 'link', type: 'button', onclick: () => { json = true; draw(); }}, 'Edit as JSON')));
		if (focusLast) {
			const inputs = box.querySelectorAll('.step input');
			if (inputs.length) inputs[inputs.length - (inputs[inputs.length - 1].style.gridColumn ? 1 : 2)].focus();
		}
	};
	draw();
	return box;
}

// ---- languages, themes… (dimensions) -----------------------------------------------------------------

// "a=1; b=2" <-> {a: "1", b: "2"}
function pairsToText(o) {
	return Object.entries(o || {}).map(([k, v]) => k + '=' + v).join('; ');
}

function textToPairs(t) {
	const o = {};
	for (const part of String(t).split(';')) {
		const i = part.indexOf('=');
		if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return o;
}

// flat "variants" (older projects) are shown and saved as one dimension called "Variant"
function dimensions() {
	if (!project.dimensions && project.variants && project.variants.length) {
		project.dimensions = [{name: 'Variant', options: project.variants}];
		delete project.variants;
	}
	return project.dimensions || (project.dimensions = []);
}

// Most sites switch a language or theme with ONE value: a localStorage key, a cookie or an address parameter.
// Then a dimension is "switched by <kind> <key>" and each option is a label and a value. Options that set
// several values, or different keys, keep the three free fields ("several values per option").
const DIM_KINDS = [['localStorage', 'localStorage'], ['cookies', 'a cookie'], ['query', 'the address (?key=value)']];

// how one option switches: {kind, key, value}; {} when it sets nothing; null when it is not one plain value
function optionSwitch(o) {
	const found = [];
	for (const [k, v] of Object.entries(o.localStorage || {})) found.push({kind: 'localStorage', key: k, value: v});
	for (const c of o.cookies || []) found.push(c && Object.keys(c).every(x => x === 'name' || x === 'value') ? {kind: 'cookies', key: c.name, value: c.value} : null);
	for (const [k, v] of Object.entries(o.query || {})) found.push({kind: 'query', key: k, value: v});
	if (!found.length) return {};
	if (found.length > 1 || !found[0] || typeof found[0].value !== 'string' || !found[0].key) return null;
	return found[0];
}

// the one {kind, key} all options of a dimension share, or null
function dimSwitch(d) {
	let kind = null, key = null;
	for (const o of d.options || []) {
		const s = optionSwitch(o);
		if (!s) return null;
		if (!s.kind) continue;
		if (kind && (s.kind !== kind || s.key !== key)) return null;
		kind = s.kind;
		key = s.key;
	}
	return {kind: kind || 'localStorage', key: key || ''};
}

function setOptionSwitch(o, kind, key, value) {
	delete o.localStorage;
	delete o.cookies;
	delete o.query;
	if (!key || value === '') return;
	if (kind === 'cookies') o.cookies = [{name: key, value}];
	else o[kind] = {[key]: value};
}

const dimView = new WeakMap(); // dimension -> {custom, kind, key} (how it is shown; not saved)

function renderDimensions() {
	const box = $('dimensions');
	box.innerHTML = '';
	dimensions().forEach((d, di) => {
		if (!d.options) d.options = [];
		if (!dimView.has(d)) {
			const s = dimSwitch(d);
			dimView.set(d, s ? {custom: false, kind: s.kind, key: s.key} : {custom: true});
		}
		const view = dimView.get(d);
		const opts = el('div');
		const count = el('span', {class: 'muted small'});
		const renderOpts = () => {
			opts.innerHTML = '';
			count.textContent = d.options.length + ' option(s)';
			if (view.custom) {
				opts.append(el('div', {class: 'option-head'},
					el('span', {}, 'Option', help('The name of this version, e.g. English or Dark. It appears in Figma, e.g. "Home — English · Dark".')),
					el('span', {}, 'localStorage', help('Values the site keeps in the browser (localStorage), set before each page opens, as key=value; several separated by ";". Example: lang=en.')),
					el('span', {}, 'Cookies', help('Cookies set for the site before each page opens, as name=value; several separated by ";". Example: theme=dark.')),
					el('span', {}, 'Address', help('Added to every page address as ?key=value. Example: lang=hy opens /index.html?lang=hy.')),
					el('span')));
				d.options.forEach((o, oi) => {
					const cookieText = (o.cookies || []).map(c => c.name + '=' + c.value).join('; ');
					opts.append(el('div', {class: 'option'},
						el('input', {value: o.name || '', placeholder: 'e.g. English', oninput: e => { o.name = e.target.value; markDirty(); }}),
						el('input', {value: pairsToText(o.localStorage), placeholder: 'localStorage: key=value', title: 'localStorage, e.g. lang=en; theme=dark', oninput: e => { const p = textToPairs(e.target.value); if (Object.keys(p).length) o.localStorage = p; else delete o.localStorage; markDirty(); }}),
						el('input', {value: cookieText, placeholder: 'cookies: name=value', title: 'Cookies, e.g. theme=dark', oninput: e => { const p = Object.entries(textToPairs(e.target.value)).map(([n, v]) => ({name: n, value: v})); if (p.length) o.cookies = p; else delete o.cookies; markDirty(); }}),
						el('input', {value: pairsToText(o.query), placeholder: 'address: key=value', title: 'Address parameters, e.g. lang=hy → ?lang=hy', oninput: e => { const p = textToPairs(e.target.value); if (Object.keys(p).length) o.query = p; else delete o.query; markDirty(); }}),
						el('button', {class: 'icon-btn danger x', type: 'button', title: 'Remove option', onclick: () => { d.options.splice(oi, 1); markDirty(); renderOpts(); }}, '×')));
				});
			} else {
				// every option is rewritten with the kind and key chosen here
				const rewrite = () => {
					const values = d.options.map(o => (optionSwitch(o) || {}).value || '');
					d.options.forEach((o, i) => setOptionSwitch(o, view.kind, view.key, values[i]));
					markDirty();
				};
				const kind = el('select', {'aria-label': 'How the site switches it', onchange: e => { view.kind = e.target.value; rewrite(); }}, DIM_KINDS.map(([v, t]) => el('option', {value: v}, t)));
				kind.value = view.kind;
				const kindBox = dropdown(kind);
				const values = [];
				// a value cannot be stored without its key, so the value boxes wait for the key
				const lockValues = () => values.forEach(v => {
					v.disabled = !view.key;
					v.placeholder = view.key ? 'e.g. en' : 'name it first (left)';
				});
				const key = el('input', {value: view.key, placeholder: 'e.g. lang', 'aria-label': 'Key', spellcheck: 'false', autocomplete: 'off', oninput: e => {
					// the values typed so far are kept while the key is being typed
					const typed = values.map(v => v.value.trim());
					view.key = e.target.value.trim();
					d.options.forEach((o, i) => setOptionSwitch(o, view.kind, view.key, typed[i] || ''));
					lockValues();
					markDirty();
				}});
				opts.append(el('div', {class: 'dim-how'}, el('span', {}, 'The site switches it by'), kindBox, el('span', {}, 'named'), el('span', {class: 'dim-key'}, key,
					help('How your site remembers the choice. Open the site, switch the language or theme, then look in the browser\'s developer tools: Application → Local Storage (or Cookies), or at the address bar. The name you see there (e.g. lang) goes here; each option below gets the value it has (e.g. en).'))));
				opts.append(el('div', {class: 'opt2-head'},
					el('span', {}, 'Option', help('The name of this version, e.g. English or Dark. It appears in Figma, e.g. "Home — English · Dark".')),
					el('span', {}, 'Value', help('What the site stores for this option, e.g. en or dark. Leave it empty for the option the site shows by default.')),
					el('span')));
				d.options.forEach((o, oi) => {
					const value = el('input', {value: (optionSwitch(o) || {}).value || '', placeholder: 'e.g. en', 'aria-label': 'Value', spellcheck: 'false', autocomplete: 'off',
						oninput: e => { setOptionSwitch(o, view.kind, view.key, e.target.value.trim()); markDirty(); }});
					values.push(value);
					opts.append(el('div', {class: 'opt2'},
						el('input', {value: o.name || '', placeholder: 'e.g. English', 'aria-label': 'Option', oninput: e => { o.name = e.target.value; markDirty(); }}),
						value,
						el('button', {class: 'icon-btn danger x', type: 'button', title: 'Remove option', onclick: () => { d.options.splice(oi, 1); markDirty(); renderOpts(); }}, '×')));
				});
				lockValues();
			}
			opts.append(el('button', {class: 'link', type: 'button', onclick: () => { d.options.push({name: ''}); markDirty(); renderOpts(); }}, '+ Add an option'));
		};
		renderOpts();
		const note = el('span', {class: 'bad small'});
		const toggle = el('button', {class: 'link', type: 'button', onclick: () => {
			note.textContent = '';
			if (view.custom) {
				const s = dimSwitch(d);
				if (!s) {
					note.textContent = 'Some options set several values, so they need these fields.';
					return;
				}
				Object.assign(view, {custom: false, kind: s.kind, key: s.key});
			} else view.custom = true;
			toggle.textContent = view.custom ? 'One value per option' : 'Several values per option';
			renderOpts();
		}}, view.custom ? 'One value per option' : 'Several values per option');
		box.append(el('div', {class: 'block'},
			el('div', {class: 'block-head'},
				el('input', {value: d.name || '', placeholder: 'What changes, e.g. Language', 'aria-label': 'Name', oninput: e => { d.name = e.target.value; markDirty(); }}),
				count,
				el('span', {style: 'flex:1'}),
				note, toggle,
				el('button', {class: 'link danger', type: 'button', onclick: () => { project.dimensions.splice(di, 1); markDirty(); renderDimensions(); }}, 'Remove')),
			opts));
	});
	if (!dimensions().length) box.append(el('p', {class: 'muted small'}, 'None: every page is captured once. Add one if the site has several languages, or a light and a dark theme.'));
}

// ---- test accounts ----------------------------------------------------------------------------------
// The usual login (open the login page, fill the user and password fields, click submit, optionally wait for
// an address) is a short form: login page, e-mail, password. Which boxes those are (CSS selectors) is found
// by "Test login" when the login fails with the standard names, or by hand. Any other login is a list of steps.
const LOGIN_FIELDS = {
	page: ['Login page', '/login.html', 'The address of the login page on your site, e.g. /login.html.'],
	user: ['E-mail or user name', 'test@example.com', 'The e-mail or user name of a test account on your site.'],
	pass: ['Password', '', 'The password of that test account. It is saved only in the project file on this computer.'],
	userField: ['User / e-mail field', '#email', 'Which box on the login page takes the e-mail or user name, written as a CSS selector (e.g. #email).'],
	passField: ['Password field', '#password', 'Which box takes the password, as a CSS selector (e.g. #password).'],
	submit: ['Submit button', 'button[type=submit]', 'The button that sends the login form, as a CSS selector.'],
	waitUrl: ['Address after login contains (optional)', 'e.g. dashboard', 'Optional: a part of the address you land on after logging in (e.g. dashboard). The capture then waits for it and notices when a login fails. Leave empty if unsure.'],
};
const LOGIN_DEFAULTS = {userField: '#email', passField: '#password', submit: 'button[type=submit]'};

// steps -> form values, or null when the steps are not the usual login
function loginToForm(steps) {
	const s = steps || [];
	if (!s.length) return {page: '/login.html', userField: '', user: '', passField: '', pass: '', submit: '', waitUrl: ''};
	const usual = (s.length === 4 || s.length === 5) && 'goto' in s[0] && 'fill' in s[1] && 'fill' in s[2] && 'click' in s[3] && (s.length === 4 || 'waitForUrl' in s[4]);
	if (!usual) return null;
	return {page: s[0].goto, userField: s[1].fill, user: s[1].value || '', passField: s[2].fill, pass: s[2].value || '', submit: s[3].click, waitUrl: s[4] ? s[4].waitForUrl : ''};
}

function formToLogin(f) {
	const steps = [{goto: f.page || '/login.html'}, {fill: f.userField || LOGIN_DEFAULTS.userField, value: f.user || ''}, {fill: f.passField || LOGIN_DEFAULTS.passField, value: f.pass || ''}, {click: f.submit || LOGIN_DEFAULTS.submit}];
	if (f.waitUrl) steps.push({waitForUrl: f.waitUrl});
	return steps;
}

const accountMode = new WeakMap(); // account -> 'form' | 'steps' (view only, not saved)
const accountLooked = new WeakSet(); // accounts whose login fields were looked for in this visit

function renderAccounts() {
	const box = $('accounts');
	box.innerHTML = '';
	(project.accounts || []).forEach((a, ai) => {
		const form = loginToForm(a.login);
		if (!accountMode.has(a)) accountMode.set(a, form ? 'form' : 'steps');
		const mode = accountMode.get(a);
		const body = el('div');
		const inputs = {};
		const note = el('div', {class: 'muted small'});
		// find the three fields on the login page; true when found
		const detect = async () => {
			note.textContent = 'Opening the login page…';
			note.className = 'muted small';
			if (dirty) await save();
			const r = await call('POST', '/api/detect-login', {project: name, page: form.page});
			accountLooked.add(a);
			if (!r.found) {
				note.textContent = 'No login form found on ' + (form.page || 'that page') + ' (a password field is needed). Check the login page address.';
				note.className = 'bad small';
				return false;
			}
			for (const f of ['userField', 'passField', 'submit']) {
				if (r[f]) {
					form[f] = r[f];
					inputs[f].value = r[f];
				}
			}
			a.login = formToLogin(form);
			markDirty();
			note.textContent = '✓ Found the login fields on "' + (r.title || form.page) + '".';
			note.className = 'ok small';
			return true;
		};
		if (mode === 'form' && form) {
			const field = (k, cls) => {
				const [label, ph, tipText] = LOGIN_FIELDS[k];
				const input = el('input', {value: form[k] || '', placeholder: ph, type: k === 'pass' ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false',
					oninput: e => { form[k] = e.target.value; a.login = formToLogin(form); markDirty(); }});
				inputs[k] = input;
				let control = input;
				if (k === 'pass') {
					control = el('div', {class: 'input-btn'}, input, el('button', {class: 'btn ghost small', type: 'button', title: 'Show or hide the password', onclick: e => {
						input.type = input.type === 'password' ? 'text' : 'password';
						e.target.textContent = input.type === 'password' ? 'Show' : 'Hide';
					}}, 'Show'));
				}
				return el('label', {class: 'field' + (cls ? ' ' + cls : '')}, el('span', {}, label, help(tipText)), control);
			};
			const findBtn = el('button', {class: 'btn ghost small', type: 'button', 'data-test-login': true, title: 'Open the login page and find its fields', onclick: async () => {
				findBtn.disabled = true;
				try {
					await detect();
				} catch (e) {
					note.textContent = e.message;
					note.className = 'bad small';
				}
				findBtn.disabled = busy;
			}}, 'Find the fields again');
			body.append(
				el('div', {class: 'account-main'}, field('page'), field('user'), field('pass')),
				note,
				el('details', {class: 'by-hand'}, el('summary', {}, 'Change the login fields by hand'),
					el('div', {class: 'account-grid'}, field('userField'), field('passField'), field('submit'), field('waitUrl')),
					findBtn));
		} else {
			body.append(el('p', {class: 'muted small'}, 'The login as steps, run in order. Start with "Go to address" (the login page).'),
				stepsEditor(() => a.login, v => { a.login = v; markDirty(); }, () => 'the account "' + (a.name || 'Account ' + (ai + 1)) + '"'));
		}
		const result = el('div', {class: 'login-result'});
		const testBtn = el('button', {class: 'btn ghost small', type: 'button', 'data-test-login': true, onclick: async () => {
			testBtn.disabled = true;
			result.innerHTML = '';
			result.append(el('span', {class: 'spinner'}), ' Logging in…');
			try {
				if (dirty) await save();
				let r = await call('POST', '/api/test-login', {project: name, account: a.name});
				// A login that works is left alone. Only when it fails and the fields still have their standard
				// names are they looked up on the login page (once), and the login tried again with what was found.
				const standard = mode === 'form' && form && ['userField', 'passField', 'submit'].every(f => !form[f] || form[f] === LOGIN_DEFAULTS[f]);
				if (!r.ok && standard && !accountLooked.has(a) && (await detect())) {
					await save();
					r = await call('POST', '/api/test-login', {project: name, account: a.name});
				}
				result.innerHTML = '';
				if (r.ok) result.append(el('div', {}, el('div', {class: 'ok'}, '✓ Logged in'), el('div', {class: 'muted'}, 'Landed on ' + r.landing)), el('img', {src: 'data:image/jpeg;base64,' + r.shot, alt: 'After login'}));
				else result.append(el('div', {class: 'bad'}, '✕ ' + r.error));
			} catch (e) {
				result.innerHTML = '';
				result.append(el('div', {class: 'bad'}, '✕ ' + e.message));
			}
			testBtn.disabled = busy;
		}}, 'Test login');
		// Form / Steps switch; going back to the form from custom steps starts a fresh form
		const seg = el('div', {class: 'seg small-seg'});
		for (const [m, label] of [['form', 'Usual login'], ['steps', 'Other (steps)']]) {
			const r = el('input', {type: 'radio', name: 'acc-mode-' + ai, value: m, checked: mode === m, onchange: () => {
				if (m === 'form' && !loginToForm(a.login)) {
					if (!confirm('These login steps do not fit the usual login. Start a new one? (The steps are replaced.)')) {
						renderAccounts();
						return;
					}
					a.login = formToLogin(loginToForm([]));
					markDirty();
				}
				accountMode.set(a, m);
				renderAccounts();
			}});
			seg.append(el('label', {}, r, label));
		}
		box.append(el('div', {class: 'block'},
			el('div', {class: 'block-head'},
				el('input', {value: a.name || '', placeholder: 'Account name, e.g. Customer', 'aria-label': 'Account name', oninput: e => { renameAccount(a, e.target.value); markDirty(); }, onchange: () => renderPages()}),
				seg,
				help('Usual login: a page with an e-mail (or user name), a password and a button. Other (steps): a list of actions for any other login, e.g. extra fields or two pages.'),
				testBtn,
				el('span', {style: 'flex:1'}),
				el('button', {class: 'link danger', type: 'button', onclick: () => { project.accounts.splice(ai, 1); markDirty(); renderAccounts(); renderPages(); }}, 'Remove')),
			body, result));
	});
	if (!(project.accounts || []).length) box.append(el('p', {class: 'muted small'}, 'None. Add one if some pages need a login.'));
}

// keep pages pointing at an account when it is renamed
function renameAccount(a, to) {
	for (const p of project.pages || []) {
		if (p.account === a.name) p.account = to;
		if (p.group === a.name) p.group = to;
	}
	a.name = to;
}

// ---- optional sections: what each holds, shown while it is closed -------------------------------------

function updateOptional() {
	if (!project) return;
	const dims = (project.dimensions || []).filter(d => d.options && d.options.length);
	$('dimSummary').textContent = dims.length ? dims.map(d => (d.name || 'No name') + ': ' + d.options.length).join(' · ') : 'None';
	const acc = project.accounts || [];
	$('accountSummary').textContent = acc.length ? acc.map(a => a.name || 'No name').join(', ') : 'None';
	const n = Object.keys(project.localStorage || {}).length;
	$('storageSummary').textContent = n ? n + (n === 1 ? ' value' : ' values') : 'None';
	// loading: what differs from the defaults
	const set = [];
	const waits = parseReadyWhen(project.readyWhen).rows.length;
	if (waits) set.push('Waits for ' + waits + (waits === 1 ? ' condition' : ' conditions'));
	if (project.settleMs != null && project.settleMs !== '') set.push('Extra wait ' + project.settleMs + ' ms');
	$('advSummary').textContent = set.length ? set.join(' · ') : 'Default';
	const rules = Object.entries(project.replaceText || {});
	$('replaceSummary').textContent = !rules.length ? 'None' : rules.length <= 3 ? rules.map(([a, b]) => a + ' → ' + (b || '(nothing)')).join(' · ') : rules.length + ' replacements';
}

// a section starts open when the project uses it, closed otherwise (when a project is opened, not while editing)
function openOptional() {
	$('dimSection').open = (project.dimensions || []).length > 0 || (project.variants || []).length > 0;
	$('accountSection').open = (project.accounts || []).length > 0;
	$('storageSection').open = Object.keys(project.localStorage || {}).length > 0;
	$('advSection').open = !!project.readyWhen; // an extra wait alone shows in the closed row
	$('replaceSection').open = Object.keys(project.replaceText || {}).length > 0;
}

// ---- wait until (settings.readyWhen) ----------------------------------------------------------------------
// readyWhen is one line of JavaScript that is true when a page has finished drawing. Here it is rows: a kind
// and what it looks at, joined by "all" (&&) or "any" (||). The rows write the same one line; a line the rows
// cannot read (other code, or && and || mixed) is one "Custom" row holding it unchanged. Nothing is rewritten
// until a row is edited.

// [kind, label, placeholder, code before the quoted value, code after it]
const WAIT_KINDS = [
	['present', 'This is on the page', 'what to look for, e.g. .content', '!!document.querySelector(', ')'],
	['gone', 'This is gone from the page', 'what must disappear, e.g. .spinner', '!document.querySelector(', ')'],
	['hasClass', 'The page has this class', 'a class of <html>, e.g. ready', 'document.documentElement.classList.contains(', ')'],
	['noClass', 'The page no longer has this class', 'a class of <html>, e.g. loading', '!document.documentElement.classList.contains(', ')'],
	['custom', 'Custom (JavaScript)', 'true when the page is ready, e.g. window.appReady'],
];

// 'text' in single quotes when that needs no escaping, else as a JSON string (also valid JavaScript)
function jsString(s) {
	return /['\\\n\r]/.test(s) ? JSON.stringify(s) : "'" + s + "'";
}

// a quoted string literal -> its text; undefined when it is not one plain literal
function fromJsString(s) {
	if (/^'[^'\\]*'$/.test(s)) return s.slice(1, -1);
	if (/^"/.test(s)) {
		try {
			const v = JSON.parse(s);
			return typeof v === 'string' ? v : undefined;
		} catch (e) {}
	}
	return undefined;
}

// split at && or || that stand outside strings and brackets: {parts, ops}
function splitConditions(code) {
	const parts = [], ops = [];
	let depth = 0, quote = '', from = 0;
	for (let i = 0; i < code.length; i++) {
		const c = code[i];
		if (quote) {
			if (c === '\\') i++;
			else if (c === quote) quote = '';
		} else if (c === "'" || c === '"' || c === '`') quote = c;
		else if ('([{'.includes(c)) depth++;
		else if (')]}'.includes(c)) depth--;
		else if (!depth && (code.startsWith('&&', i) || code.startsWith('||', i))) {
			parts.push(code.slice(from, i).trim());
			ops.push(code.substr(i, 2));
			from = i + 2;
			i++;
		}
	}
	parts.push(code.slice(from).trim());
	return {parts, ops};
}

function parseCondition(code) {
	for (const [kind, , , before, after] of WAIT_KINDS) {
		if (!before) continue;
		// "document.querySelector('x')" without "!!" means the same as with it
		for (const b of kind === 'present' ? [before, before.slice(2)] : [before]) {
			if (code.startsWith(b) && code.endsWith(after)) {
				const v = fromJsString(code.slice(b.length, code.length - after.length).trim());
				if (v !== undefined) return {kind, value: v};
			}
		}
	}
	// brackets around the whole of it were put there by conditionCode
	if (/^\(.*\)$/s.test(code) && splitConditions(code.slice(1, -1)).parts.length && balanced(code.slice(1, -1))) return {kind: 'custom', value: code.slice(1, -1).trim()};
	return {kind: 'custom', value: code};
}

function balanced(code) {
	let depth = 0, quote = '';
	for (let i = 0; i < code.length; i++) {
		const c = code[i];
		if (quote) {
			if (c === '\\') i++;
			else if (c === quote) quote = '';
		} else if (c === "'" || c === '"' || c === '`') quote = c;
		else if (c === '(') depth++;
		else if (c === ')' && --depth < 0) return false;
	}
	return depth === 0 && !quote;
}

// readyWhen -> {any, rows: [{kind, value}]}
function parseReadyWhen(code) {
	const text = String(code || '').trim();
	if (!text) return {any: false, rows: []};
	const {parts, ops} = splitConditions(text);
	const mixed = new Set(ops).size > 1;
	if (mixed || parts.some(p => !p)) return {any: false, rows: [{kind: 'custom', value: text}]};
	return {any: ops[0] === '||', rows: parts.map(parseCondition)};
}

// rows -> readyWhen ('' when there is nothing to wait for)
function readyWhenCode(any, rows) {
	const filled = rows.filter(r => r.value.trim());
	const codes = filled.map(r => {
		const k = WAIT_KINDS.find(x => x[0] === r.kind);
		if (k[3]) return k[3] + jsString(r.value.trim()) + k[4];
		const code = r.value.trim();
		// own code keeps to itself among other conditions
		// (anything but a plain name or call gets brackets, so "a ? b : c" or "x || y" cannot mix with the rest)
		return filled.length > 1 && !/^!*[\w$.]+(\([^()]*\))?$/.test(code) ? '(' + code + ')' : code;
	});
	return codes.join(any ? ' || ' : ' && ');
}

let waitState = {any: false, rows: []};

function renderWait() {
	waitState = parseReadyWhen(project.readyWhen);
	drawWait();
}

function drawWait(focusLast) {
	const box = $('waitRows');
	box.innerHTML = '';
	const sync = () => {
		const code = readyWhenCode(waitState.any, waitState.rows);
		if (code) project.readyWhen = code; else delete project.readyWhen;
		markDirty();
	};
	waitState.rows.forEach((row, i) => {
		const k = WAIT_KINDS.find(x => x[0] === row.kind);
		const kind = el('select', {'aria-label': 'What to wait for', onchange: e => { row.kind = e.target.value; sync(); drawWait(); }}, WAIT_KINDS.map(x => el('option', {value: x[0]}, x[1])));
		kind.value = row.kind;
		box.append(el('div', {class: 'wait-row'}, dropdown(kind),
			el('input', {value: row.value, placeholder: k[2], 'aria-label': k[1], spellcheck: 'false', autocomplete: 'off', oninput: e => { row.value = e.target.value; sync(); }}),
			el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove this condition', onclick: () => { waitState.rows.splice(i, 1); sync(); drawWait(); }}, '×')));
	});
	if (!waitState.rows.length) box.append(el('p', {class: 'muted small wait-none'}, 'Nothing extra: every page is captured once it has loaded, the network is quiet and the fonts are in.'));
	// "all" or "any" only matters from two conditions on
	$('waitJoin').hidden = waitState.rows.length < 2;
	document.querySelectorAll('input[name=wait-join]').forEach(r => {
		r.checked = (r.value === 'any') === waitState.any;
		r.onchange = () => { waitState.any = r.value === 'any'; sync(); };
	});
	$('addWait').onclick = () => {
		waitState.rows.push({kind: 'custom', value: ''}); // the owner's choice of default; the list offers the rest
		drawWait(true);
	};
	if (focusLast) {
		const inputs = box.querySelectorAll('.wait-row input');
		inputs[inputs.length - 1].focus();
	}
}

// ---- replace text ---------------------------------------------------------------------------------------
// project.replaceText {from: to}: characters or words swapped in all text before importing. Edited like Local
// storage: a table (one row per replacement) or Bulk text (one from=to per line). The rows are the editing
// state (they may hold an empty or repeated "from" while typing); the project gets the rows with a "from".
let replaceRows = [];

function replaceMode() {
	return localStorageGet('replaceMode') === 'bulk' ? 'bulk' : 'table';
}

function renderReplace() {
	replaceRows = Object.entries(project.replaceText || {}).map(([a, b]) => [a, String(b)]);
	document.querySelectorAll('input[name=replace-mode]').forEach(r => {
		r.checked = r.value === replaceMode();
		r.onchange = () => {
			localStorageSet('replaceMode', r.value);
			showReplace();
		};
	});
	$('addReplace').onclick = () => {
		replaceRows.push(['', '']);
		renderReplaceRows();
		const from = $('replaceRows').querySelectorAll('input.k');
		from[from.length - 1].focus();
	};
	$('replaceBulkText').oninput = () => {
		replaceRows = [];
		for (const line of $('replaceBulkText').value.split('\n')) {
			const i = line.indexOf('=', 1); // from the second character on: the first may itself be "="
			if (i > 0) replaceRows.push([line.slice(0, i), line.slice(i + 1)]);
		}
		syncReplace();
	};
	showReplace();
}

function showReplace() {
	const bulk = replaceMode() === 'bulk';
	$('replaceTable').hidden = bulk;
	$('replaceBulk').hidden = !bulk;
	if (bulk) $('replaceBulkText').value = replaceRows.filter(([a]) => a).map(([a, b]) => a + '=' + b).join('\n');
	else renderReplaceRows();
}

function renderReplaceRows() {
	const body = $('replaceRows');
	body.innerHTML = '';
	replaceRows.forEach((row, i) => {
		body.append(el('tr', {},
			el('td', {}, el('input', {class: 'k', value: row[0], placeholder: 'e.g. ֏', 'aria-label': 'Find', spellcheck: false, autocomplete: 'off', oninput: e => { row[0] = e.target.value; syncReplace(); }})),
			el('td', {}, el('input', {class: 'v', value: row[1], placeholder: 'e.g. AMD (empty = remove it)', 'aria-label': 'Replace with', spellcheck: false, autocomplete: 'off', oninput: e => { row[1] = e.target.value; syncReplace(); }})),
			el('td', {class: 'c-more'}, el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove this replacement', onclick: () => { replaceRows.splice(i, 1); syncReplace(); renderReplaceRows(); }}, '×'))));
	});
	$('replaceWrap').hidden = !replaceRows.length;
}

// (text is replaced exactly as typed, spaces included, so nothing is trimmed)
function syncReplace() {
	const o = {};
	for (const [a, b] of replaceRows) if (a) o[a] = b;
	if (Object.keys(o).length) project.replaceText = o; else delete project.replaceText;
	markDirty();
}

// ---- local storage (project-wide) -----------------------------------------------------------------------

// rows [key, value] are the editing state (they may hold empty or repeated keys while typing);
// project.localStorage gets the rows with a key, the last one winning
let storageRows = [];

function storageMode() {
	return localStorageGet('storageMode') === 'bulk' ? 'bulk' : 'table';
}

function renderStorage() {
	storageRows = Object.entries(project.localStorage || {}).map(([k, v]) => [k, typeof v === 'string' ? unquoteJson(v) : JSON.stringify(v)]);
	document.querySelectorAll('input[name=storage-mode]').forEach(r => {
		r.checked = r.value === storageMode();
		r.onchange = () => {
			localStorageSet('storageMode', r.value);
			showStorage();
		};
	});
	$('addStorage').onclick = () => {
		storageRows.push(['', '']);
		renderStorageRows();
		const keys = $('storageRows').querySelectorAll('input.k');
		keys[keys.length - 1].focus();
	};
	$('storageText').oninput = () => {
		storageRows = textToRows($('storageText').value);
		syncStorage();
	};
	showStorage();
}

function showStorage() {
	const bulk = storageMode() === 'bulk';
	$('storageTable').hidden = bulk;
	$('storageBulk').hidden = !bulk;
	if (bulk) $('storageText').value = storageRows.filter(([k, v]) => k || v).map(([k, v]) => k + '=' + v).join('\n');
	else renderStorageRows();
	checkStorage();
}

function renderStorageRows() {
	const body = $('storageRows');
	body.innerHTML = '';
	storageRows.forEach((row, i) => {
		const value = el('input', {class: 'v', value: row[1], placeholder: 'value, e.g. [{"id":3}] or "en"', spellcheck: false, oninput: e => { row[1] = e.target.value; syncStorage(); }});
		body.append(el('tr', {},
			el('td', {}, el('input', {class: 'k', value: row[0], placeholder: 'key', spellcheck: false, oninput: e => { row[0] = e.target.value; syncStorage(); }})),
			el('td', {}, value),
			el('td', {class: 'c-more'}, el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove this value', onclick: () => { storageRows.splice(i, 1); syncStorage(); renderStorageRows(); }}, '×'))));
	});
	$('storageWrap').hidden = !storageRows.length;
	checkStorage();
}

// "key=value" per line; the value may contain "="
function textToRows(text) {
	const rows = [];
	for (const line of text.split('\n')) {
		const i = line.indexOf('=');
		if (i > 0) rows.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
	}
	return rows;
}

// A value copied from code, like '[{"id":3}]' from localStorage.setItem('k', '[…]'), keeps its quotes;
// the site would get text that isn't JSON. Drop quotes around JSON ([…] or {…}) that parses without them.
function unquoteJson(v) {
	const m = /^(['"`])\s*([[{][\s\S]*[\]}])\s*\1$/.exec(v);
	if (!m) return v;
	try {
		JSON.parse(m[2]);
		return m[2];
	} catch (e) {
		return v;
	}
}

function syncStorage() {
	const o = {};
	for (const [k, v] of storageRows) if (k.trim()) o[k.trim()] = unquoteJson(v.trim());
	if (Object.keys(o).length) project.localStorage = o; else delete project.localStorage;
	checkStorage();
	markDirty();
}

// values that look like JSON ([…] or {…}) must parse, or the site reading them gets nothing
function checkStorage() {
	const bad = [];
	const inputs = $('storageRows').querySelectorAll('input.v');
	storageRows.forEach(([k, v], i) => {
		let ok = true;
		const t = unquoteJson(v.trim());
		if (/^['"`]?\s*[[{]/.test(t)) {
			try {
				JSON.parse(t);
			} catch (e) {
				ok = false;
				bad.push(k.trim() || '(no key)');
			}
		}
		if (inputs[i]) inputs[i].classList.toggle('invalid', !ok);
	});
	$('storageErr').hidden = !bad.length;
	$('storageErr').textContent = bad.length ? 'Not valid JSON: ' + bad.join(', ') + '. Check for a missing bracket, an extra comma at the end or quotes around it.' : '';
	updateOptional();
}

// ---- 3. pages ---------------------------------------------------------------------------------------
// The list is drawn in groups, like a task list: one <tbody> per group (a header with a fold arrow, the
// group's name as a coloured label and its count; its pages; an "Add a page" row). Groups come in the order
// they first appear in project.pages, then the empty ones.
// Dragging a page by its handle puts it before or after the page it is dropped on (project.pages is
// reordered, which is also the order of the frames in Figma) or at the end of the group whose header it is
// dropped on.
// A group exists in the settings file only through its pages, so a new, still empty group is kept here
// (per project, until the panel is reloaded) and is saved once a page is in it.

const OPEN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>';
// a caret with rounded corners (filled, and outlined in the same colour with round joins), drawn in the middle
// of a 16px box; in a 24px button the 4px either side is a whole number of screen pixels at 100 %, 125 % and 150 %
const FOLD_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4.5 6h7L8 10z"/></svg>';

// where "open" goes: an address site directly; a folder through the panel server, which serves it (saved folder)
function pageHref(p) {
	const where = p || '/';
	if (project.source && project.source.url) {
		try {
			return new URL(where, new URL(project.source.url).origin + '/').href;
		} catch (e) {
			return '#';
		}
	}
	return '/api/open?project=' + encodeURIComponent(name) + '&path=' + encodeURIComponent(where);
}

const groupOf = p => p.group || '';

const groupViews = {}; // project file name -> {empty: [group names without pages], closed: Set of folded groups}
function groupView() {
	return groupViews[name] || (groupViews[name] = {empty: [], closed: new Set()});
}

// every group to draw: those of the pages in order of first appearance, then the empty ones
function groupNames() {
	const used = [...new Set((project.pages || []).map(groupOf))];
	const view = groupView();
	view.empty = [...new Set(view.empty)].filter(g => g && !used.includes(g));
	return used.concat(view.empty);
}

// a steady colour per group name, for its label
const GROUP_HUES = [212, 262, 330, 20, 45, 150, 185, 290];
function groupHue(g) {
	let h = 0;
	for (const ch of g) h = (h * 31 + ch.codePointAt(0)) >>> 0;
	return GROUP_HUES[h % GROUP_HUES.length];
}

let pageRowEls = []; // the drawn rows [{p, tr, stepsRow, simHit}], for the search
let groupEls = []; // the drawn groups [{g, body, tick, members}]
let dragPage = null; // the page being dragged
let dragGroup = null; // or the group being dragged (its name)
const rowPage = new WeakMap(); // a page's <tr> (and its steps row) -> the page

// The list is captured group by group, in the order shown. So after every change made here project.pages
// is written the way it is shown: each group's pages together, the groups in their shown order. (Opening a
// project does not rewrite it; the capture orders an unsorted list the same way, src/capture.js.)
function keepGroupsTogether(order) {
	const pages = project.pages || [];
	const names = order || [...new Set(pages.map(groupOf))];
	project.pages = names.flatMap(g => pages.filter(p => groupOf(p) === g));
}

// put pages in a group, at its end (a group that had no pages comes last)
function setGroup(list, g) {
	const pages = project.pages;
	const moved = list.filter(p => groupOf(p) !== g);
	if (moved.length) {
		const rest = pages.filter(p => !moved.includes(p));
		const last = rest.filter(p => groupOf(p) === g).pop();
		for (const p of moved) {
			if (g) p.group = g; else delete p.group;
		}
		rest.splice(last ? rest.indexOf(last) + 1 : rest.length, 0, ...moved);
		project.pages = rest;
		keepGroupsTogether();
		markDirty();
	}
	renderPages();
}

// put a whole group before or after another one
function moveGroup(g, target, before) {
	if (g === target) return;
	const order = [...new Set(project.pages.map(groupOf))].filter(x => x !== g);
	if (!order.includes(target)) return;
	order.splice(order.indexOf(target) + (before ? 0 : 1), 0, g);
	keepGroupsTogether(order);
	markDirty();
	renderPages();
}

// put a page before or after another one; it joins that page's group
function movePage(p, target, before) {
	const pages = project.pages;
	if (p === target) return;
	pages.splice(pages.indexOf(p), 1);
	pages.splice(pages.indexOf(target) + (before ? 0 : 1), 0, p);
	if (groupOf(target)) p.group = target.group; else delete p.group;
	keepGroupsTogether();
	markDirty();
	renderPages();
}

// put a page at the end of a group
function moveToGroup(p, g) {
	const pages = project.pages;
	const last = pages.filter(x => x !== p && groupOf(x) === g).pop();
	if (last) return movePage(p, last, false);
	setGroup([p], g);
}

// Draws the page list again, where the reader is: drawing takes every row out first, and for that moment the page
// is shorter, so the browser pulls the window up; it then stays up (a page removed near the bottom jumped about
// seven rows). The window's and the list's own scroll positions are kept across the drawing.
function renderPages() {
	const wrap = $('pageTable').closest('.table-wrap');
	const y = window.scrollY, x = wrap ? wrap.scrollLeft : 0;
	drawPages();
	if (window.scrollY !== y) window.scrollTo(window.scrollX, y);
	if (wrap && wrap.scrollLeft !== x) wrap.scrollLeft = x;
}

function drawPages() {
	const table = $('pageTable');
	const wasAdding = !!table.querySelector('tr.add-row.adding') && table.contains(document.activeElement);
	table.querySelectorAll('tbody').forEach(b => b.remove());
	pageRowEls = [];
	groupEls = [];
	const pages = project.pages || (project.pages = []);
	const accounts = (project.accounts || []).map(a => a.name);
	// the Account column only when there is an account to choose (or a page already names one)
	const withAccount = accounts.length > 0 || pages.some(p => p.account);
	$('accountHead').hidden = !withAccount;
	const cols = withAccount ? 6 : 5;
	const view = groupView();
	const names = groupNames();
	for (const g of names) {
		const members = pages.filter(p => groupOf(p) === g);
		const body = el('tbody', {class: 'group' + (view.closed.has(g) ? ' closed' : '')});
		const fold = el('button', {class: 'icon-btn fold', type: 'button', title: 'Fold or unfold this group', 'aria-expanded': String(!view.closed.has(g)), onclick: () => {
			if (view.closed.has(g)) view.closed.delete(g); else view.closed.add(g);
			body.classList.toggle('closed', view.closed.has(g));
			fold.setAttribute('aria-expanded', String(!view.closed.has(g)));
		}});
		fold.innerHTML = '<span>' + FOLD_ICON + '</span>'; // a span the button centres with flex (panel.css)
		const tick = el('input', {type: 'checkbox', title: 'All pages of this group', 'aria-label': 'All pages of this group', disabled: !members.length, onchange: e => {
			for (const r of pageRowEls) {
				if (!members.includes(r.p) || r.tr.classList.contains('filtered')) continue;
				if (e.target.checked) delete r.p.skip; else r.p.skip = true;
			}
			markDirty();
			renderPages();
		}});
		// the label is the group's name: typing renames the group of all its pages (drawn again when left)
		const label = el('input', {class: 'group-name', value: g, placeholder: 'No group', 'aria-label': 'Group name', title: 'Rename this group', autocomplete: 'off', spellcheck: 'false',
			oninput: e => {
				const v = e.target.value.trim();
				if (members.length) {
					for (const p of members) {
						if (v) p.group = v; else delete p.group;
					}
					markDirty();
				} else {
					const i = view.empty.indexOf(label.dataset.now);
					if (i >= 0) view.empty[i] = v;
				}
				if (view.closed.delete(label.dataset.now)) view.closed.add(v);
				label.dataset.now = v;
				labelBox.dataset.text = e.target.value || label.placeholder;
			},
			onchange: () => renderPages(),
			onkeydown: e => { if (e.key === 'Enter') e.target.blur(); }});
		label.dataset.now = g;
		const labelBox = el('span', {class: 'group-label', style: '--g: ' + groupHue(g)}, label);
		labelBox.dataset.text = g || label.placeholder;
		const head = el('div', {class: 'group-head'}, fold, labelBox, el('span', {class: 'muted small'}, members.length));
		const lead = el('span', {class: 'group-lead'});
		// a group with pages can be dragged by its handle to another place among the groups
		const grip = el('span', {class: 'drag', draggable: 'true', title: 'Drag to reorder the groups', 'aria-hidden': 'true'}, '⠿');
		grip.addEventListener('dragstart', e => {
			dragGroup = label.dataset.now;
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', dragGroup);
			try {
				e.dataTransfer.setDragImage(body.querySelector('.group-row'), 12, 14);
			} catch (err) {}
			setTimeout(() => body.classList.add('dragging'), 0);
		});
		grip.addEventListener('dragend', endDrag);
		if (!members.length) {
			head.append(el('span', {class: 'muted small'}, 'empty: drag pages here, or add one below'),
				el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove this empty group', onclick: () => { view.empty = view.empty.filter(x => x !== label.dataset.now); renderPages(); }}, '×'));
		}
		// the header starts at the list's left edge; the pages under it are set in a little (panel.css)
		lead.append(members.length ? grip : el('span', {class: 'drag none'}), tick);
		head.prepend(lead);
		body.append(el('tr', {class: 'group-row'}, el('td', {colspan: cols}, head)));
		for (const p of members) body.append(...pageRow(p, pages, accounts, withAccount, cols));
		body.append(addRow(label, cols, withAccount));
		// where a dragged page would land: before / after the row under the pointer, or at the end of the group
		const target = e => {
			const tr = e.target.closest('tr');
			const over = tr && rowPage.get(tr);
			if (!over) return {end: true};
			const main = tr.classList.contains('steps-row') ? tr.previousElementSibling : tr;
			const r = main.getBoundingClientRect();
			return {over, main, before: !tr.classList.contains('steps-row') && e.clientY < r.top + r.height / 2};
		};
		// a dragged group lands before or after this one: the half of this group the pointer is in
		const groupSide = e => {
			const r = body.getBoundingClientRect();
			return e.clientY < r.top + r.height / 2;
		};
		body.addEventListener('dragover', e => {
			if (dragGroup !== null) {
				clearDropMarks();
				if (dragGroup === label.dataset.now || !members.length) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				body.classList.add(groupSide(e) ? 'drop-group-before' : 'drop-group-after');
				return;
			}
			if (!dragPage) return;
			const t = target(e);
			clearDropMarks();
			if (t.over === dragPage) return;
			if (t.end && groupOf(dragPage) === g && members[members.length - 1] === dragPage) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			if (t.end) body.classList.add('drop');
			else t.main.classList.add(t.before ? 'drop-before' : 'drop-after');
		});
		body.addEventListener('dragleave', e => {
			if (!body.contains(e.relatedTarget)) clearDropMarks();
		});
		body.addEventListener('drop', e => {
			if (dragGroup !== null) {
				e.preventDefault();
				const from = dragGroup, before = groupSide(e);
				endDrag();
				if (members.length) moveGroup(from, label.dataset.now, before);
				return;
			}
			if (!dragPage) return;
			e.preventDefault();
			const t = target(e), p = dragPage;
			endDrag();
			if (t.over === p) return;
			if (t.end) moveToGroup(p, label.dataset.now);
			else movePage(p, t.over, t.before);
		});
		table.append(body);
		groupEls.push({g, body, tick, members});
	}
	$('noPages').hidden = pages.length > 0;
	$('addPage').hidden = names.length > 0 || !$('addPageForm').hidden; // each group has its own "Add a page"
	refreshGroupList();
	applyPageFilter();
	updateSummary();
	if (inlineAdd !== null && wasAdding) {
		const row = table.querySelector('tr.add-row.adding input');
		if (row) row.focus();
	}
}

// The last row of a group: "+ Add a page", which turns into a page row to fill in right there: a name and an
// address in the list's own columns. Enter (or Add) puts the page at the end of this group and leaves the row
// ready for the next one; Escape, ×, or leaving it empty closes it. Steps are added afterwards with "⋯".
let inlineAdd = null; // the group whose add row is open (its name), or null

function addRow(label, cols, withAccount) {
	const tr = el('tr', {class: 'add-row'});
	const group = () => label.dataset.now;
	const closed = () => {
		tr.replaceChildren(el('td', {class: 'c-drag'}), el('td'), el('td', {colspan: cols - 2},
			el('button', {class: 'link', type: 'button', onclick: () => {
				// one add row at a time: drawing the list again closes any other and opens this group's
				inlineAdd = group();
				renderPages();
				const input = $('pageTable').querySelector('tr.add-row.adding input');
				if (input) input.focus();
			}}, '+ Add a page')));
		tr.classList.remove('adding');
	};
	const open = focus => {
		fillPathList();
		const nameInput = el('input', {placeholder: 'Name', 'aria-label': 'Name of the new page', autocomplete: 'off'});
		const pathInput = el('input', {placeholder: 'Address, e.g. /about.html', 'aria-label': 'Address of the new page', list: 'pathList', autocomplete: 'off', spellcheck: 'false'});
		// until a name is typed, the name box shows the one the address gives
		pathInput.addEventListener('input', () => {
			pathInput.classList.remove('invalid');
			nameInput.placeholder = pathInput.value.trim() ? nameFromPath(pathInput.value.trim()) : 'Name';
		});
		const cancel = () => {
			inlineAdd = null;
			closed();
		};
		const add = () => {
			let path = pathInput.value.trim();
			if (!path) {
				pathInput.classList.add('invalid');
				return pathInput.focus();
			}
			if (!/^(\/|https?:\/\/)/i.test(path)) path = '/' + path;
			const page = {name: nameInput.value.trim() || nameFromPath(path), path};
			const g = group();
			if (g) page.group = g;
			const pages = project.pages || (project.pages = []);
			const mates = pages.filter(x => groupOf(x) === g), last = mates[mates.length - 1];
			// a group whose pages all log in with one account (e.g. "Member") gives it to the new page too
			if (last && last.account && mates.every(x => x.account === last.account)) page.account = last.account;
			if (last) pages.splice(pages.indexOf(last) + 1, 0, page); else pages.push(page);
			keepGroupsTogether();
			$('pageSearch').value = ''; // the new row must be visible
			inlineAdd = g; // stays open for the next page
			markDirty();
			renderPages();
		};
		const keys = e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				add();
			}
			if (e.key === 'Escape') cancel();
		};
		nameInput.addEventListener('keydown', keys);
		pathInput.addEventListener('keydown', keys);
		// left empty: it closes by itself
		tr.addEventListener('focusout', () => setTimeout(() => {
			if (tr.isConnected && !tr.contains(document.activeElement) && !nameInput.value.trim() && !pathInput.value.trim() && inlineAdd === group()) cancel();
		}, 150));
		const cells = [el('td', {class: 'c-drag'}), el('td'), el('td', {}, nameInput), el('td', {}, pathInput)];
		if (withAccount) cells.push(el('td'));
		cells.push(el('td', {class: 'c-more'},
			el('button', {class: 'btn small', type: 'button', onclick: add}, 'Add'),
			el('button', {class: 'icon-btn', type: 'button', title: 'Cancel', 'aria-label': 'Cancel', onclick: cancel}, '×')));
		tr.replaceChildren(...cells);
		tr.classList.add('adding');
		if (focus) nameInput.focus();
	};
	if (inlineAdd === group()) open(false); else closed();
	tr.openAdd = open;
	return tr;
}

// the addresses Find pages has seen, offered while typing an address
function fillPathList() {
	const known = new Set();
	for (const p of project.pages || []) for (const x of [p.path].concat(p.similar || [])) if (x) known.add(x);
	$('pathList').replaceChildren(...[...known].slice(0, 300).map(x => el('option', {value: x})));
}

// the two rows of one page: the page itself, and its steps and screens (closed until "⋯")
function pageRow(p, pages, accounts, withAccount, cols) {
	const tr = el('tr', {class: p.skip ? 'off' : ''});
	const include = el('input', {type: 'checkbox', checked: !p.skip, 'aria-label': 'Capture this page', onchange: e => { if (e.target.checked) delete p.skip; else p.skip = true; tr.classList.toggle('off', !!p.skip); markDirty(); updateAllBox(); }});
	const text = (k, ph) => el('input', {value: p[k] || '', placeholder: ph, oninput: e => { if (e.target.value) p[k] = e.target.value; else delete p[k]; markDirty(); }});
	const pathInput = text('path', '/page.html');
	const open = el('a', {class: 'icon-btn open-page', target: '_blank', rel: 'noopener', href: pageHref(p.path), title: 'Open in your browser (as a visitor; steps are not run)', 'aria-label': 'Open this page in your browser'});
	open.innerHTML = OPEN_ICON;
	pathInput.addEventListener('input', () => { open.href = pageHref(p.path); });
	const simHit = el('div', {class: 'sim-hit muted small', hidden: true});
	// only the handle starts a drag, so text in the row can still be selected
	const handle = el('span', {class: 'drag', draggable: 'true', title: 'Drag to reorder, or onto another group', 'aria-hidden': 'true'}, '⠿');
	handle.addEventListener('dragstart', e => {
		dragPage = p;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', p.name || p.path || '');
		try {
			e.dataTransfer.setDragImage(tr, 12, 14);
		} catch (err) {}
		// after the drag has started: changing the page during dragstart can cancel it
		setTimeout(() => tr.classList.add('dragging'), 0);
	});
	handle.addEventListener('dragend', endDrag);
	const stepsRow = el('tr', {class: 'steps-row', hidden: true});
	// screens: none ticked = every screen of the project; e.g. a "menu open" state only where there is a burger
	const screenBox = el('div', {class: 'page-screens'});
	for (const o of pageScreenOptions(p)) {
		const cb = el('input', {type: 'checkbox', value: o.id, checked: !!(p.screens && p.screens.includes(o.id))});
		cb.onchange = () => {
			const on = [...screenBox.querySelectorAll('input:checked')].map(x => x.value);
			if (on.length) p.screens = on; else delete p.screens;
			markDirty();
			refreshTags();
		};
		screenBox.append(el('label', {class: 'chip'}, cb, ' ' + o.label));
	}
	let stepsDrawn = false;
	const stepsCell = el('td', {colspan: cols - 2});
	const drawSteps = () => {
		if (stepsDrawn) return;
		stepsDrawn = true;
		stepsCell.append(
			el('div', {class: 'muted small'}, 'Before capturing, do these in order', help('For a state of the page: open a menu, fill a form, show a dialog. Each step names what it acts on with a CSS selector, e.g. #open-menu or .btn-login; right-click the element in your browser → Inspect to find its id or class. "Go to address" as the first step replaces the page address.')),
			stepsEditor(() => p.steps, v => { if (v.length) p.steps = v; else delete p.steps; markDirty(); refreshTags(); }, () => 'the page "' + (p.name || p.path || '') + '"'),
			el('div', {class: 'muted small page-screens-label'}, 'Screens for this page (none ticked = all of them). A state that clicks a burger button only works on the sizes where the burger shows.'),
			screenBox);
	};
	stepsRow.append(el('td', {class: 'c-drag'}), el('td'), stepsCell);
	const tagBox = el('span', {class: 'tags'});
	const more = el('button', {class: 'icon-btn', type: 'button', title: 'Steps and screens for this page', onclick: () => { drawSteps(); stepsRow.hidden = !stepsRow.hidden; }}, '⋯');
	function refreshTags() {
		const tags = [];
		if (p.similar && p.similar.length) tags.push(el('span', {class: 'tag', title: p.similar.slice(0, 10).join('\n')}, '+' + p.similar.length + ' similar'));
		if (p.steps && p.steps.length) tags.push(el('span', {class: 'tag'}, p.steps.length + (p.steps.length === 1 ? ' step' : ' steps')));
		if (p.screens) tags.push(el('span', {class: 'tag', title: 'Only on: ' + p.screens.join(', ')}, 'some screens'));
		if (p.variants) tags.push(el('span', {class: 'tag', title: 'Only for: ' + p.variants.join(', ')}, 'some variants'));
		tagBox.replaceChildren(...tags);
		more.className = 'icon-btn' + ((p.steps && p.steps.length) || p.screens ? ' on' : '');
	}
	refreshTags();
	tr.append(
		el('td', {class: 'c-drag'}, handle),
		el('td', {class: 'c-check'}, include),
		el('td', {}, text('name', 'Name')),
		el('td', {}, el('div', {class: 'addr'}, pathInput, open), simHit));
	if (withAccount) {
		const acc = el('select', {'aria-label': 'Account', onchange: e => { if (e.target.value) p.account = e.target.value; else delete p.account; markDirty(); }},
			el('option', {value: ''}, '—'), accounts.map(n => el('option', {value: n}, n)));
		// an account the project no longer has stays visible (and saved) until another is chosen
		if (p.account && !accounts.includes(p.account)) acc.append(el('option', {value: p.account}, p.account + ' (missing)'));
		acc.value = p.account || '';
		tr.append(el('td', {}, dropdown(acc, 'in-row')));
	}
	tr.append(el('td', {class: 'c-more'}, tagBox, more,
		el('button', {class: 'icon-btn', type: 'button', title: 'Add a state of this page (the same page after some steps, e.g. "menu open")', onclick: () => openAddForm(p)}, '⧉'),
		el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove from the list', onclick: () => {
			// the rows below move up one; the focus goes to the × of the row now in this place (else the one above),
			// so removing several pages in a row works with the keyboard too
			const shown = pageRowEls.filter(r => !r.tr.classList.contains('filtered'));
			const k = shown.findIndex(r => r.p === p);
			pages.splice(pages.indexOf(p), 1);
			markDirty();
			renderPages();
			const now = pageRowEls.filter(r => !r.tr.classList.contains('filtered'));
			const next = now[k] || now[k - 1];
			const btn = next && next.tr.querySelector('[title="Remove from the list"]');
			if (btn) btn.focus({preventScroll: true});
		}}, '×')));
	pageRowEls.push({p, tr, stepsRow, simHit});
	rowPage.set(tr, p);
	rowPage.set(stepsRow, p);
	return [tr, stepsRow];
}

function clearDropMarks() {
	document.querySelectorAll('.pages .drop, .pages .drop-before, .pages .drop-after, .pages .drop-group-before, .pages .drop-group-after').forEach(x => x.classList.remove('drop', 'drop-before', 'drop-after', 'drop-group-before', 'drop-group-after'));
}

function endDrag() {
	dragPage = null;
	dragGroup = null;
	clearDropMarks();
	document.querySelectorAll('.pages .dragging').forEach(x => x.classList.remove('dragging'));
}

// a new group: drawn empty at the end, its name ready to be typed over
function newGroup() {
	const taken = groupNames();
	let n = 1;
	while (taken.includes(n === 1 ? 'New group' : 'New group ' + n)) n++;
	const g = n === 1 ? 'New group' : 'New group ' + n;
	groupView().empty.push(g);
	$('pageSearch').value = ''; // the new group must be visible
	renderPages();
	const made = groupEls.find(x => x.g === g);
	if (made) {
		const input = made.body.querySelector('.group-name');
		input.scrollIntoView({block: 'nearest'});
		input.focus();
		input.select();
	}
}

// the groups (empty ones too), offered while typing a group
function refreshGroupList() {
	const groups = groupNames().filter(Boolean);
	$('groupList').replaceChildren(...groups.map(g => el('option', {value: g})));
}

// ---- page search: hides the rows that do not match (the list and its order stay as they are) ----------

function pageQuery() {
	return $('pageSearch').value.trim().toLowerCase();
}

// a page matches by name, address, group or account; or by one of its "similar" addresses, which is shown
function applyPageFilter() {
	const raw = $('pageSearch').value.trim(), q = raw.toLowerCase();
	let shown = 0;
	for (const r of pageRowEls) {
		const p = r.p;
		const direct = !q || [p.name, p.path, p.group, p.account].some(v => v && String(v).toLowerCase().includes(q));
		const sim = !direct && (p.similar || []).find(x => String(x).toLowerCase().includes(q));
		const on = direct || !!sim;
		r.tr.classList.toggle('filtered', !on);
		r.stepsRow.classList.toggle('filtered', !on);
		r.simHit.hidden = !sim;
		if (sim) {
			const i = sim.toLowerCase().indexOf(q);
			r.simHit.replaceChildren('Similar address: ', sim.slice(0, i), el('mark', {}, sim.slice(i, i + q.length)), sim.slice(i + q.length));
		}
		if (on) shown++;
	}
	// a group none of whose pages match is not shown
	// while searching: a folded group still shows its matches, and a group without one is not shown
	const visible = new Set(shownPages());
	$('pageTable').classList.toggle('searching', !!q);
	for (const g of groupEls) g.body.hidden = !!q && !g.members.some(p => visible.has(p));
	const total = pageRowEls.length;
	$('pageTools').hidden = !total;
	$('pageSearchInfo').textContent = !q ? '' : shown ? shown + ' of ' + total + ' shown' : 'No page matches “' + raw + '”';
	updateAllBox();
}

function shownPages() {
	return pageRowEls.filter(r => !r.tr.classList.contains('filtered')).map(r => r.p);
}

$('pageSearch').addEventListener('input', applyPageFilter);
$('pageSearch').addEventListener('keydown', e => {
	if (e.key === 'Escape' && e.target.value) {
		e.preventDefault();
		e.target.value = '';
		applyPageFilter();
	}
});
$('newGroup').onclick = newGroup;

// ---- add a page, or a state of a page ------------------------------------------------------------------

let addFrom = null; // the page a new state is made from
let addSteps = [];

// "/about-us.html" -> "About us"; "/" and "/index.html" -> "Home"
function nameFromPath(p) {
	const seg = String(p).split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
	const base = decodeURIComponent(seg).replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim();
	if (!base || base.toLowerCase() === 'index') return 'Home';
	return base.charAt(0).toUpperCase() + base.slice(1);
}

// from: the page a state is made of (or nothing); group: the group whose "Add a page" was clicked
function openAddForm(from, group) {
	const pages = project.pages || [];
	addFrom = from || null;
	addSteps = [];
	$('addPageForm').hidden = false;
	$('addPage').hidden = true;
	$('apTitle').textContent = from ? 'A state of "' + (from.name || from.path || 'this page') + '": the same page after some steps' : 'Add a page';
	$('apPath').value = from ? from.path || '' : '';
	$('apName').value = from ? (from.name || 'Page') + ' — state' : '';
	$('apName').dataset.auto = from ? '' : '1';
	$('apGroup').value = from ? from.group || '' : group !== undefined ? group : pages.length ? pages[pages.length - 1].group || '' : 'Pages';
	$('apError').textContent = '';
	fillPathList();
	$('apSteps').replaceChildren(stepsEditor(() => addSteps, v => { addSteps = v; }, () => 'the new page'));
	(from ? $('apName') : $('apPath')).focus();
	$('addPageForm').scrollIntoView({block: 'nearest'});
}

function closeAddForm() {
	$('addPageForm').hidden = true;
	$('addPage').hidden = !project || groupNames().length > 0;
	$('apSteps').replaceChildren();
	addFrom = null;
}

function submitAddForm() {
	let path = $('apPath').value.trim();
	if (!path) {
		$('apError').textContent = 'Enter the page address, e.g. /about.html.';
		return $('apPath').focus();
	}
	const problem = stepsProblem();
	if (problem) return ($('apError').textContent = problem);
	if (!/^(\/|https?:\/\/)/i.test(path)) path = '/' + path;
	const page = {name: $('apName').value.trim() || nameFromPath(path), path};
	const g = $('apGroup').value.trim();
	if (g) page.group = g;
	if (addFrom) {
		for (const k of ['account', 'screens', 'variants']) if (addFrom[k]) page[k] = JSON.parse(JSON.stringify(addFrom[k]));
	}
	if (addSteps.length) page.steps = addSteps;
	const pages = project.pages || (project.pages = []);
	const at = addFrom ? pages.indexOf(addFrom) : -1;
	const last = pages.filter(x => groupOf(x) === groupOf(page)).pop();
	if (at >= 0) pages.splice(at + 1, 0, page);
	else if (last) pages.splice(pages.indexOf(last) + 1, 0, page); // at the end of its group
	else pages.push(page);
	keepGroupsTogether();
	$('pageSearch').value = ''; // the new row must be visible
	closeAddForm();
	markDirty();
	renderPages();
	const row = pageRowEls.find(r => r.p === page);
	if (row) row.tr.scrollIntoView({block: 'nearest'});
}

$('apPath').addEventListener('input', () => {
	if ($('apName').dataset.auto) $('apName').value = $('apPath').value.trim() ? nameFromPath($('apPath').value.trim()) : '';
});
$('apName').addEventListener('input', () => { $('apName').dataset.auto = ''; });
$('apAdd').onclick = submitAddForm;
$('apCancel').onclick = closeAddForm;
for (const id of ['apPath', 'apName', 'apGroup']) {
	$(id).addEventListener('keydown', e => {
		if (e.key === 'Enter') submitAddForm();
		if (e.key === 'Escape') closeAddForm();
	});
}

// The screens a page can be limited to: the project's sizes (a phone or tablet means both orientations), plus any
// other id already in the page (e.g. "tablet-portrait" written by hand), so saving keeps it.
function pageScreenOptions(p) {
	const out = [];
	for (const s of project.screens || []) {
		if (typeof s === 'object') {
			out.push({id: (s.name || 'custom').toLowerCase().replace(/\s+/g, '-'), label: s.name || 'Custom'});
		} else {
			const key = s.split(':')[0];
			if (info.presets[key]) out.push({id: key, label: info.presets[key].label});
		}
	}
	for (const id of p.screens || []) if (!out.some(o => o.id === id)) out.push({id, label: id});
	return out;
}

// the header box ticks or unticks the pages shown (all of them without a search); the count is the whole list
function updateAllBox() {
	const pages = project.pages || [];
	const shown = pageQuery() ? shownPages() : pages;
	const ticked = shown.filter(p => !p.skip).length;
	$('allPages').checked = shown.length > 0 && ticked === shown.length;
	$('allPages').indeterminate = ticked > 0 && ticked < shown.length;
	$('allPages').title = pageQuery() ? 'All shown' : 'All';
	const on = pages.filter(p => !p.skip).length;
	$('pageCount').textContent = on + (on < pages.length ? ' / ' + pages.length : '');
	// each group's own box: its pages among those shown
	const visible = new Set(shown);
	for (const g of groupEls) {
		const mine = g.members.filter(p => visible.has(p)), t = mine.filter(p => !p.skip).length;
		g.tick.checked = mine.length > 0 && t === mine.length;
		g.tick.indeterminate = t > 0 && t < mine.length;
	}
}

function onCrawlEvent(ev) {
	if (ev.type === 'log') {
		$('crawlLog').textContent += ev.text + '\n';
		$('crawlLog').scrollTop = 1e9;
	}
}

async function findPages() {
	const problem = sourceProblem();
	if (problem) {
		$('crawlJob').hidden = false;
		$('crawlJob').querySelector('.spinner').hidden = true;
		$('crawlStatus').textContent = problem;
		return;
	}
	try {
		if (dirty) await save();
		setBusy(true, 'Finding pages…');
		$('crawlJob').hidden = false;
		$('crawlJob').querySelector('.spinner').hidden = false;
		$('crawlLog').textContent = '';
		$('crawlStatus').textContent = 'Finding pages… (opening the site in the browser and following its links)';
		const {job} = await call('POST', '/api/crawl', {project: name, save: true, unlinked: $('crawlUnlinked').checked});
		showCancel('crawlCancel', job);
		const r = await follow(job, onCrawlEvent);
		project = await call('GET', '/api/projects/' + encodeURIComponent(name));
		renderPages();
		$('crawlStatus').textContent = 'Found ' + r.pages.length + ' page(s)' + (r.unlinked.length ? ' and ' + r.unlinked.length + ' not linked' : '') + '; ' + r.added + ' new added to the list.' + (r.truncated ? ' Stopped at the page limit.' : '');
		$('crawlJob').querySelector('.spinner').hidden = true;
	} catch (e) {
		$('crawlStatus').textContent = e.cancelled ? 'Cancelled. No pages were added.' : 'Could not find pages: ' + e.message;
		$('crawlJob').querySelector('.spinner').hidden = true;
	} finally {
		setBusy(false);
	}
}

// ---- 5. capture -------------------------------------------------------------------------------------

function variantCount() {
	// as the capture counts them (src/capture.js variantList): a dimension needs a name and options
	const dims = (project.dimensions || []).filter(d => d && d.name && d.options && d.options.length);
	if (dims.length) return dims.reduce((n, d) => n * d.options.length, 1);
	return (project.variants || []).length || 1;
}

// the screens a capture makes, as src/screens.js resolves them: [{id, preset}] ("phone-portrait", preset "phone")
function resolvedScreens() {
	const out = [];
	for (const s of project.screens && project.screens.length ? project.screens : ['desktop']) {
		if (typeof s === 'object') {
			const id = (s.name || 'custom').toLowerCase().replace(/\s+/g, '-');
			out.push({id, preset: id});
			continue;
		}
		const [key, forced] = s.split(':');
		const p = info.presets[key];
		if (!p || !p.mobile) {
			out.push({id: key, preset: key});
			continue;
		}
		const orients = forced ? [forced] : project.orientation === 'both' ? ['portrait', 'landscape'] : [project.orientation || 'portrait'];
		for (const o of orients) out.push({id: key + '-' + o, preset: key});
	}
	return out;
}

function updateSummary() {
	if (!project) return;
	const list = (project.pages || []).filter(p => !p.skip);
	const pages = list.length;
	const screens = resolvedScreens(), s = screens.length, v = variantCount();
	// pages limited to some screens make fewer frames
	const frames = list.reduce((n, p) => n + (p.screens ? screens.filter(x => p.screens.includes(x.id) || p.screens.includes(x.preset)).length : s), 0) * v;
	// with no size ticked the capture uses Desktop (src/screens.js): say so
	const noSize = !(project.screens && project.screens.length);
	$('captureSummary').textContent = pages + ' page(s) × ' + (noSize ? 'Desktop (no size ticked)' : s + ' screen(s)') + (v > 1 ? ' × ' + v + ' variants' : '') + ' ≈ ' + frames + ' frames';
	$('captureBtn').disabled = busy || !pages;
	updateOptional();
}

function onCaptureEvent(ev) {
	if (ev.type === 'log') {
		$('captureLog').textContent += ev.text + '\n';
		$('captureLog').scrollTop = 1e9;
	}
	if (ev.type === 'progress') {
		$('captureBar').style.width = Math.round(100 * ev.done / ev.total) + '%';
		$('captureStatus').textContent = ev.done + ' / ' + ev.total + ' · ' + ev.screen + (ev.variant ? ' · ' + ev.variant : '') + ' · ' + ev.page;
	}
}

async function runCapture() {
	const problem = sourceProblem();
	if (problem) {
		$('captureProgress').hidden = false;
		$('captureBar').style.width = '0';
		$('captureStatus').textContent = problem;
		return;
	}
	try {
		if (dirty) await save();
		setBusy(true, 'Capturing…');
		$('captureProgress').hidden = false;
		$('captureLogBox').hidden = false;
		$('captureResult').hidden = true;
		$('captureLog').textContent = '';
		$('captureBar').style.width = '0';
		$('captureStatus').textContent = 'Starting the browser…';
		const {job} = await call('POST', '/api/capture', {project: name});
		showCancel('captureCancel', job);
		const r = await follow(job, onCaptureEvent);
		$('captureStatus').textContent = 'Done.';
		const box = $('captureResult');
		box.innerHTML = '';
		box.append(el('div', {class: r.failures.length ? 'bad' : 'ok'}, (r.failures.length ? '⚠ ' : '✓ ') + r.captures + ' frame(s) captured' + (r.failures.length ? ', ' + r.failures.length + ' failed' : '')));
		if (r.file) box.append(el('div', {class: 'muted small'}, r.file + ' · ' + (r.size / 1048576).toFixed(1) + ' MB · ', el('a', {href: '/api/captures/' + encodeURIComponent(r.file) + '?download'}, 'Download JSON')));
		if (r.failures.length) box.append(el('ul', {}, r.failures.slice(0, 20).map(f => el('li', {}, f.screen + (f.variant ? ' / ' + f.variant : '') + ' · ' + f.name + ': ' + f.error))));
		box.hidden = false;
		renderCaptures();
	} catch (e) {
		$('captureStatus').textContent = e.cancelled ? 'Cancelled. Nothing was saved.' : 'Capture failed: ' + e.message;
	} finally {
		setBusy(false);
	}
}

const TRASH = /Win/.test(navigator.platform || navigator.userAgent) ? 'Recycle Bin' : 'Trash';

let captureFiles = []; // every capture file, newest first: [{file, size, modified, project?, capturedAt?}]

function mb(bytes) {
	return (bytes / 1048576).toFixed(1) + ' MB';
}

// one capture in a list: file, (project,) time, size, Download, remove
function captureItem(c, withProject) {
	return el('li', {}, el('span', {class: 'cap-file'}, c.file), el('span', {class: 'muted'}, (withProject && c.project ? c.project + ' · ' : '') + new Date(c.modified).toLocaleString() + ' · ' + mb(c.size) + ' · ', el('a', {href: '/api/captures/' + encodeURIComponent(c.file) + '?download'}, 'Download'),
		el('button', {class: 'icon-btn danger', type: 'button', 'data-remove-capture': true, title: 'Move to the ' + TRASH, disabled: busy, onclick: () => removeCaptures(c.file, 'Move "' + c.file + '" to the ' + TRASH + '?')}, '×')));
}

async function renderCaptures() {
	const list = captureFiles = await call('GET', '/api/captures');
	const ul = $('captureList');
	ul.innerHTML = '';
	for (const c of list.slice(0, 8)) ul.append(captureItem(c, false));
	if (!list.length) ul.append(el('li', {class: 'muted'}, 'None yet.'));
	const total = list.reduce((s, c) => s + c.size, 0);
	$('viewAllCaptures').hidden = !list.length;
	$('viewAllCaptures').textContent = 'View all (' + list.length + ')';
	$('removeAllCaptures').hidden = !list.length;
	$('removeAllCaptures').onclick = () => removeCaptures(null, 'Move all ' + list.length + ' capture(s) (' + mb(total) + ') to the ' + TRASH + '?\n\nThis includes older captures not shown in the list.');
	if ($('allCaptures').open) renderAllCaptures();
}

// one capture by file name, some (a list of names), or all of them (null); they go to the recycle bin / Trash
async function removeCaptures(files, question) {
	if (busy || !confirm(question)) return;
	$('captureListError').textContent = '';
	$('capAllError').textContent = '';
	try {
		if (Array.isArray(files)) await call('DELETE', '/api/captures', {files});
		else await call('DELETE', '/api/captures' + (files ? '/' + encodeURIComponent(files) : ''));
	} catch (e) {
		$($('allCaptures').open ? 'capAllError' : 'captureListError').textContent = e.message;
	}
	renderCaptures();
}

// ---- all captures (dialog): search, project and date filters ------------------------------------------

function openAllCaptures() {
	const projects = [...new Set(captureFiles.map(c => c.project).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	const current = project && project.name;
	if (projects.includes(current)) projects.unshift(...projects.splice(projects.indexOf(current), 1)); // current first
	const sel = $('capProject'), keep = sel.value;
	sel.replaceChildren(el('option', {value: ''}, 'All projects'), ...projects.map(p => el('option', {value: p}, p)));
	sel.value = projects.includes(keep) ? keep : '';
	syncDropdown(sel);
	$('capAllError').textContent = '';
	renderAllCaptures();
	$('allCaptures').showModal();
	$('capSearch').focus();
}

function shownCaptures() {
	const q = $('capSearch').value.trim().toLowerCase(), proj = $('capProject').value, days = Number($('capDate').value);
	const from = !days ? 0 : days === 1 ? new Date().setHours(0, 0, 0, 0) : Date.now() - days * 864e5;
	return captureFiles.filter(c => (!q || c.file.toLowerCase().includes(q) || (c.project || '').toLowerCase().includes(q))
		&& (!proj || c.project === proj) && (!from || Date.parse(c.modified) >= from));
}

function renderAllCaptures() {
	const list = shownCaptures();
	const size = list.reduce((s, c) => s + c.size, 0);
	$('capAllList').replaceChildren(...list.map(c => captureItem(c, true)));
	if (!list.length) $('capAllList').append(el('li', {class: 'muted'}, captureFiles.length ? 'No capture matches.' : 'None yet.'));
	$('capAllInfo').textContent = list.length + ' of ' + captureFiles.length + ' · ' + mb(size);
	$('capRemoveShown').textContent = 'Remove shown (' + list.length + ')';
	$('capRemoveShown').disabled = busy || !list.length;
	$('capRemoveShown').onclick = () => removeCaptures(list.map(c => c.file), 'Move the ' + list.length + ' capture(s) shown (' + mb(size) + ') to the ' + TRASH + '?');
}

$('viewAllCaptures').onclick = openAllCaptures;
$('allCapturesClose').onclick = () => $('allCaptures').close();
$('capSearch').addEventListener('input', renderAllCaptures);
dropdown($('capProject'));
dropdown($('capDate'));
$('capProject').onchange = renderAllCaptures;
$('capDate').onchange = renderAllCaptures;

// ---- folder browser ---------------------------------------------------------------------------------

let browseTarget = null, browseAt = '';

async function browseTo(p) {
	try {
		const r = await call('GET', '/api/browse?path=' + encodeURIComponent(p || ''));
		browseAt = r.path;
		$('browsePath').textContent = r.path || 'This computer';
		$('browseUp').disabled = r.parent === null;
		$('browseUp').onclick = () => browseTo(r.parent);
		$('browseChoose').disabled = !r.path;
		$('browseInfo').textContent = r.path ? (r.html ? r.html + ' HTML file(s) here' : 'No HTML files directly in this folder') : '';
		const ul = $('browseDirs');
		ul.innerHTML = '';
		for (const d of r.dirs) ul.append(el('li', {onclick: () => browseTo(d.path)}, d.name));
		if (!r.dirs.length) ul.append(el('li', {class: 'muted'}, 'No folders inside'));
	} catch (e) {
		$('browseInfo').textContent = e.message;
	}
}

// "Browse…": the system's own folder window (Explorer / Finder), opened by the panel server on this computer;
// the in-page folder list only when the system has no such window
document.addEventListener('click', async e => {
	const b = e.target.closest('[data-browse]');
	if (!b || b.disabled) return;
	browseTarget = $(b.dataset.browse);
	const label = b.textContent;
	b.disabled = true;
	b.textContent = 'Choose in the window…';
	try {
		const r = await call('POST', '/api/pick-folder', {start: browseTarget.value || ''});
		if (r.path) {
			browseTarget.value = r.path.split('\\').join('/');
			browseTarget.dispatchEvent(new Event('input'));
		} else if (r.unavailable) {
			$('browser').showModal();
			browseTo(browseTarget.value || '');
		}
	} catch (err) {
		$('browser').showModal();
		await browseTo(browseTarget.value || '');
		// an older panel server (started before an update) does not know the system folder window yet
		if (/Unknown API/.test(err.message)) $('browseInfo').textContent = 'For your system\'s folder window, restart the panel: close its black window and start it again.';
	} finally {
		b.disabled = false;
		b.textContent = label;
	}
});
$('browseClose').onclick = () => $('browser').close();
$('browseChoose').onclick = () => {
	const v = browseAt.split('\\').join('/');
	browseTarget.value = v;
	browseTarget.dispatchEvent(new Event('input'));
	$('browser').close();
};

// ---- new project, wiring ----------------------------------------------------------------------------

function showNewForm() {
	if (dirty && !confirm('Discard unsaved changes to "' + name + '"?')) return;
	dirty = false;
	showSaveState();
	$('newForm').hidden = false;
	$('emptyState').hidden = true;
	$('projectView').hidden = true;
	$('npError').textContent = '';
	$('npName').value = '';
	$('npFolder').value = '';
	$('npUrl').value = '';
	$('npName').focus();
}

document.querySelectorAll('input[name=npKind]').forEach(r => {
	r.onchange = () => {
		$('npFolderRow').hidden = r.value !== 'folder';
		$('npUrlRow').hidden = r.value !== 'url';
	};
});

$('createProject').onclick = async () => {
	const kind = document.querySelector('input[name=npKind]:checked').value;
	const source = kind === 'folder' ? {folder: $('npFolder').value.trim()} : {url: $('npUrl').value.trim()};
	if (!$('npName').value.trim()) return ($('npError').textContent = 'Give the project a name.');
	if (!source.folder && !source.url) return ($('npError').textContent = kind === 'folder' ? 'Choose the folder with the HTML files.' : 'Enter the address of the site.');
	// a running site starts where its address points ("/" for http://localhost:3000), not at /index.html,
	// which many of them do not have
	let start;
	if (source.url) {
		try {
			if (!/^https?:\/\/./i.test(source.url)) throw new Error();
			start = new URL(source.url).pathname || '/';
		} catch (e) {
			return ($('npError').textContent = 'The address must start with http:// or https:// (e.g. http://localhost:3000).');
		}
	}
	try {
		const r = await call('POST', '/api/projects', {name: $('npName').value.trim(), source, start});
		await loadProjects(r.name);
	} catch (e) {
		$('npError').textContent = e.message;
	}
};

$('cancelNew').onclick = () => {
	$('newForm').hidden = true;
	$('npError').textContent = '';
	return loadProjects(name);
};
$('emptyNew').onclick = showNewForm;
$('saveProject').onclick = () => save().catch(e => alert(e.message));
$('projectSelect').onchange = async e => {
	if (dirty && !confirm('Discard unsaved changes to "' + name + '"?')) {
		e.target.value = name;
		renderPicker();
		return;
	}
	await openProject(e.target.value);
	renderPicker();
};
$('deleteProject').onclick = async () => {
	if (!confirm('Delete the project "' + name + '"?\n\nIts settings file is moved to the folder projects/deleted (you can bring it back from there). Captures stay.')) return;
	await call('DELETE', '/api/projects/' + encodeURIComponent(name));
	dirty = false;
	showSaveState();
	await loadProjects();
};
$('addCustom').onclick = () => {
	// a name no other custom size has: "Custom", "Custom 2"…
	const names = (project.screens || []).filter(s => typeof s === 'object').map(s => s.name);
	let n = 1;
	while (names.includes(n === 1 ? 'Custom' : 'Custom ' + n)) n++;
	project.screens = (project.screens || []).concat({name: n === 1 ? 'Custom' : 'Custom ' + n, width: 1200, height: 800});
	markDirty();
	renderCustomScreens();
	renderPages();
};
$('addDimension').onclick = () => {
	dimensions().push({name: project.dimensions.length ? 'Theme' : 'Language', options: [{name: ''}]});
	markDirty();
	renderDimensions();
};
$('addAccount').onclick = () => {
	project.accounts = (project.accounts || []).concat({name: 'Account ' + ((project.accounts || []).length + 1), login: formToLogin(loginToForm([]))});
	// (formToLogin of an empty form is the usual login, so it opens as the form)
	markDirty();
	renderAccounts();
	renderPages();
};
$('addPage').onclick = () => openAddForm(null);
$('allPages').onchange = e => {
	for (const p of pageQuery() ? shownPages() : project.pages || []) {
		if (e.target.checked) delete p.skip; else p.skip = true;
	}
	markDirty();
	renderPages();
};
$('findPages').onclick = findPages;
$('captureBtn').onclick = runCapture;
$('crawlCancel').onclick = cancelJob;
$('captureCancel').onclick = cancelJob;

(async () => {
	info = await call('GET', '/api/info');
	await loadProjects();
	if (info.running) {
		const job = info.running, crawling = job.kind === 'crawl';
		setBusy(true, job.title + '…');
		const target = crawling ? 'crawlStatus' : 'captureStatus';
		if (crawling) $('crawlJob').hidden = false;
		else {
			$('captureProgress').hidden = false;
			$('captureLogBox').hidden = false;
		}
		$(target).textContent = job.title + ' is running…';
		showCancel(crawling ? 'crawlCancel' : 'captureCancel', job.id);
		follow(job.id, crawling ? onCrawlEvent : onCaptureEvent)
			.then(() => ' finished.', e => (e.cancelled ? ' was cancelled. Nothing was saved.' : ' failed: ' + e.message))
			.then(async end => {
				setBusy(false);
				if (crawling) {
					$('crawlJob').querySelector('.spinner').hidden = true;
					if (project && !dirty) await openProject(name); // the found pages were saved to the project
				}
				$(target).textContent = job.title + end;
				renderCaptures();
			});
	}
})();

// ---- top bar menu (narrow windows): Help and the theme behind one ⋯ button ------------------------------
// On wide windows the button is not shown and its menu's items stand in the bar (panel.css: display: contents).
(function () {
	const wrap = $('topMore');
	const btn = $('moreBtn');
	const setOpen = open => {
		wrap.classList.toggle('open', open);
		btn.setAttribute('aria-expanded', String(open));
	};
	btn.addEventListener('click', () => {
		const open = !wrap.classList.contains('open');
		setOpen(open);
		if (open) wrap.querySelector('.more-menu a').focus();
	});
	document.addEventListener('click', e => { if (!wrap.contains(e.target)) setOpen(false); });
	document.addEventListener('keydown', e => {
		if (e.key === 'Escape' && wrap.classList.contains('open')) {
			setOpen(false);
			btn.focus();
		}
	});
	// keyboard: leaving the menu with Tab closes it
	wrap.addEventListener('focusout', e => { if (!wrap.contains(e.relatedTarget)) setOpen(false); });
	// a theme picked here is applied at once (theme.js); the menu then gets out of the way
	wrap.querySelectorAll('.theme-switch input').forEach(r => r.addEventListener('change', () => setOpen(false)));
	matchMedia('(min-width: 761px)').addEventListener('change', () => setOpen(false));
})();
