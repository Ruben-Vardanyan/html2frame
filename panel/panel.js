// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// panel.js — the control panel page (vanilla JS). Edits one project's settings (docs/PLAN.md "Settings file"),
// runs "Find pages" (crawl) and "Capture" as server jobs, follows them over Server-Sent Events and can cancel them.
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
	for (const id of ['findPages', 'captureBtn', 'saveProject', 'newProject', 'projectSelect', 'projectBtn', 'deleteProject', 'removeAllCaptures']) $(id).disabled = b || (id === 'saveProject' && !dirty);
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

function markDirty() {
	dirty = true;
	$('saveState').textContent = 'Unsaved changes';
	$('saveState').className = 'save-state dirty';
	$('saveProject').disabled = busy;
	updateSummary();
}

async function save() {
	if (!project) return;
	collectAdvanced();
	await call('PUT', '/api/projects/' + encodeURIComponent(name), project);
	// a new name renames the project file too ("Insurance", not "Insurance (Fixture)")
	if (project.name && project.name.trim() && project.name.trim() !== name) {
		try {
			const r = await call('POST', '/api/projects/' + encodeURIComponent(name) + '/rename', {to: project.name.trim()});
			if (r.name !== name) {
				name = r.name;
				localStorageSet('project', name);
				await refreshProjectList();
			}
		} catch (e) {
			$('saveState').textContent = 'Saved (not renamed: ' + e.message + ')';
		}
	} else {
		await refreshProjectList();
	}
	dirty = false;
	if (!/not renamed/.test($('saveState').textContent)) $('saveState').textContent = 'Saved';
	$('saveState').className = 'save-state';
	$('saveProject').disabled = true;
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
	[...sel.options].forEach((o, i) => {
		$('projectMenu').append(el('li', {role: 'option', 'aria-selected': String(i === sel.selectedIndex), 'data-value': o.value, title: o.textContent,
			onclick: () => choosePicker(o.value)}, o.textContent));
	});
}

function pickerOpen(open) {
	const menu = $('projectMenu');
	menu.hidden = !open;
	$('projectBtn').setAttribute('aria-expanded', String(open));
	if (open) {
		const items = [...menu.children];
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
	const items = [...menu.children];
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
		if (i >= 0) choosePicker(items[i].dataset.value);
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
	const pick = select || localStorageGet('project') || (list[0] && list[0].name);
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
	$('saveState').textContent = '';
	$('saveProject').disabled = true;
	$('newForm').hidden = true;
	$('projectView').hidden = false;
	$('captureResult').hidden = true;
	renderAll();
}

function renderAll() {
	renderProjectCard();
	renderScreens();
	renderDimensions();
	renderAccounts();
	renderStorage();
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
			if (r.value === 'url') delete project.source.folder; else delete project.source.url;
			markDirty();
		};
	});
	showKind(kind);
	$('replaceText').value = Object.entries(project.replaceText || {}).map(([a, b]) => a + '=' + b).join('\n');
	$('replaceText').oninput = markDirty;
}

function showKind(kind) {
	$('folderRow').hidden = kind !== 'folder';
	$('urlRow').hidden = kind !== 'url';
}

function collectAdvanced() {
	const rt = {};
	for (const line of $('replaceText').value.split('\n')) {
		const i = line.indexOf('=');
		if (i > 0) rt[line.slice(0, i)] = line.slice(i + 1);
	}
	if (Object.keys(rt).length) project.replaceText = rt; else delete project.replaceText;
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
		};
		box.append(el('div', {class: 'custom'},
			el('input', {value: s.name || '', placeholder: 'Name, e.g. Kiosk', 'aria-label': 'Name', oninput: e => upd('name', e.target.value)}),
			el('input', {type: 'number', min: 100, value: s.width || '', placeholder: 'Width', 'aria-label': 'Width (px)', title: 'Width (px)', oninput: e => upd('width', e.target.value)}),
			el('input', {type: 'number', min: 100, value: s.height || '', placeholder: 'Height', 'aria-label': 'Height (px)', title: 'Height (px)', oninput: e => upd('height', e.target.value)}),
			el('label', {class: 'check small'}, el('input', {type: 'checkbox', checked: !!s.mobile, onchange: e => { s.mobile = e.target.checked || undefined; markDirty(); }}), 'touch',
				help('Capture this size as a touch device (phone, tablet, touchscreen kiosk): the site sees a touch screen without a mouse and uses its mobile page settings, so touch-only designs appear. Leave it off for desktop and laptop sizes.')),
			el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove this size', onclick: () => { project.screens.splice(i, 1); markDirty(); renderCustomScreens(); }}, '×')));
	});
}

// ---- 3. dimensions (languages, themes…) and accounts -----------------------------------------------

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

function renderDimensions() {
	const box = $('dimensions');
	box.innerHTML = '';
	dimensions().forEach((d, di) => {
		const opts = el('div');
		const renderOpts = () => {
			opts.innerHTML = '';
			opts.append(el('div', {class: 'option-head'},
				el('span', {}, 'Option', help('The name of this version, e.g. English or Dark. It appears in Figma, e.g. "Home — English · Dark".')),
				el('span', {}, 'localStorage', help('Values the site keeps in the browser (localStorage), set before each page opens, as key=value; several separated by ";". Example: lang=en. Look in the browser\'s developer tools (Application → Local Storage) to see what your site uses.')),
				el('span', {}, 'Cookies', help('Cookies set for the site before each page opens, as name=value; several separated by ";". Example: theme=dark.')),
				el('span', {}, 'Address (?key=value)', help('Added to every page address as ?key=value. Example: lang=hy opens /index.html?lang=hy.')),
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
			opts.append(el('button', {class: 'link', type: 'button', onclick: () => { d.options.push({name: ''}); markDirty(); renderOpts(); }}, '+ Add an option'));
		};
		renderOpts();
		box.append(el('div', {class: 'block'},
			el('div', {class: 'block-head'},
				el('input', {value: d.name || '', placeholder: 'Dimension, e.g. Language', oninput: e => { d.name = e.target.value; markDirty(); }}),
				el('span', {class: 'muted small'}, d.options.length + ' option(s)'),
				el('span', {style: 'flex:1'}),
				el('button', {class: 'link danger', type: 'button', onclick: () => { project.dimensions.splice(di, 1); markDirty(); renderDimensions(); }}, 'Remove')),
			opts));
	});
	if (!dimensions().length) box.append(el('p', {class: 'muted small'}, 'None: every page is captured once. Add a dimension for languages or themes.'));
}

// Accounts: the usual login (open the login page, fill the user and password fields, click submit, optionally
// wait for an address) as a form; any other login as JSON steps. Each account can switch between the two.
const LOGIN_FIELDS = [
	['page', 'Login page', '/login.html', 'The address of the login page on your site, e.g. /login.html. "Detect fields" opens it and finds the fields below.'],
	['userField', 'User / e-mail field', '#email', 'Which box on the login page takes the e-mail or user name, written as a CSS selector (e.g. #email). "Detect fields" fills it for you.'],
	['user', 'E-mail or user name', 'test@example.com', 'The e-mail or user name of a test account on your site.'],
	['passField', 'Password field', '#password', 'Which box takes the password, as a CSS selector (e.g. #password). "Detect fields" fills it for you.'],
	['pass', 'Password', '', 'The password of that test account. It is saved only in the project file on this computer.'],
	['submit', 'Submit button', 'button[type=submit]', 'The button that sends the login form, as a CSS selector. "Detect fields" fills it for you.'],
	['waitUrl', 'After login the address contains (optional)', 'e.g. dashboard', 'Optional: a part of the address you land on after logging in (e.g. dashboard). The capture then waits for it and notices when a login fails. Leave empty if unsure.'],
];

// steps -> form values, or null when the steps are not the usual login
function loginToForm(steps) {
	const s = steps || [];
	if (!s.length) return {page: '/login.html', userField: '', user: '', passField: '', pass: '', submit: '', waitUrl: ''};
	const usual = (s.length === 4 || s.length === 5) && 'goto' in s[0] && 'fill' in s[1] && 'fill' in s[2] && 'click' in s[3] && (s.length === 4 || 'waitForUrl' in s[4]);
	if (!usual) return null;
	return {page: s[0].goto, userField: s[1].fill, user: s[1].value || '', passField: s[2].fill, pass: s[2].value || '', submit: s[3].click, waitUrl: s[4] ? s[4].waitForUrl : ''};
}

function formToLogin(f) {
	const steps = [{goto: f.page || '/login.html'}, {fill: f.userField || '#email', value: f.user || ''}, {fill: f.passField || '#password', value: f.pass || ''}, {click: f.submit || 'button[type=submit]'}];
	if (f.waitUrl) steps.push({waitForUrl: f.waitUrl});
	return steps;
}

const accountMode = new WeakMap(); // account -> 'form' | 'steps' (view only, not saved)

function renderAccounts() {
	const box = $('accounts');
	box.innerHTML = '';
	(project.accounts || []).forEach((a, ai) => {
		const form = loginToForm(a.login);
		if (!accountMode.has(a)) accountMode.set(a, form ? 'form' : 'steps');
		const mode = accountMode.get(a);
		const body = el('div');
		if (mode === 'form' && form) {
			const inputs = {};
			const grid = el('div', {class: 'account-grid'});
			for (const [k, label, ph, tipText] of LOGIN_FIELDS) {
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
				if (k === 'page') {
					const detect = el('button', {class: 'btn ghost small', type: 'button', 'data-test-login': true, title: 'Open the login page and find its fields', onclick: async () => {
						detect.disabled = true;
						note.textContent = 'Opening the login page…';
						note.className = 'muted small';
						try {
							if (dirty) await save();
							const r = await call('POST', '/api/detect-login', {project: name, page: form.page});
							if (r.found) {
								for (const f of ['userField', 'passField', 'submit']) {
									if (r[f]) {
										form[f] = r[f];
										inputs[f].value = r[f];
									}
								}
								a.login = formToLogin(form);
								markDirty();
								note.textContent = '✓ Found the fields on "' + (r.title || form.page) + '". Now enter the e-mail and password.';
								note.className = 'ok small';
							} else {
								note.textContent = 'No login form found on that page (a password field is needed). Check the login page address.';
								note.className = 'bad small';
							}
						} catch (e) {
							note.textContent = e.message;
							note.className = 'bad small';
						}
						detect.disabled = busy;
					}}, 'Detect fields');
					control = el('div', {class: 'input-btn'}, input, detect);
				}
				grid.append(el('label', {class: 'field' + (k === 'page' || k === 'waitUrl' ? ' wide' : '')}, el('span', {}, label, tipText ? help(tipText) : null), control));
			}
			const note = el('div', {class: 'muted small'}, 'Tip: enter the login page and click Detect fields; then fill in the e-mail and password.');
			body.append(grid, note);
		} else {
			const ta = el('textarea', {rows: 8, spellcheck: 'false'}, JSON.stringify(a.login || [], null, '\t'));
			const err = el('div', {class: 'bad small'});
			ta.oninput = () => {
				try {
					const v = JSON.parse(ta.value);
					if (!Array.isArray(v)) throw new Error('The steps must be a list: [ … ]');
					a.login = v;
					ta.style.borderColor = '';
					err.textContent = '';
					markDirty();
				} catch (e) {
					ta.style.borderColor = 'var(--danger)';
					err.textContent = e.message;
				}
			};
			body.append(el('p', {class: 'muted small'}, 'Login steps, run in order: goto, fill (with value), click, select, check, press, wait, waitFor, waitForUrl… (the full list is in docs/PLAN.md).'), ta, err);
		}
		const result = el('div', {class: 'login-result'});
		const testBtn = el('button', {class: 'btn ghost small', type: 'button', 'data-test-login': true, onclick: async () => {
			testBtn.disabled = true;
			result.innerHTML = '';
			result.append(el('span', {class: 'spinner'}), ' Logging in…');
			try {
				if (dirty) await save();
				const r = await call('POST', '/api/test-login', {project: name, account: a.name});
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
		for (const [m, label] of [['form', 'Form'], ['steps', 'Steps (JSON)']]) {
			const r = el('input', {type: 'radio', name: 'acc-mode-' + ai, value: m, checked: mode === m, onchange: () => {
				if (m === 'form' && !loginToForm(a.login)) {
					if (!confirm('These login steps do not fit the form. Start a new form? (The custom steps are replaced.)')) {
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
				el('input', {value: a.name || '', placeholder: 'Account name, e.g. Customer', oninput: e => { renameAccount(a, e.target.value); markDirty(); }}),
				seg,
				help('Form: the usual login with an e-mail (or user name) and a password. Steps (JSON): a list of actions for any other login, e.g. extra fields or two steps.'),
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

// ---- 4. stored values (project-wide localStorage) -----------------------------------------------------

// rows [key, value] are the editing state (they may hold empty or repeated keys while typing);
// project.localStorage gets the rows with a key, the last one winning
let storageRows = [];

function storageMode() {
	return localStorageGet('storageMode') === 'bulk' ? 'bulk' : 'table';
}

function renderStorage() {
	storageRows = Object.entries(project.localStorage || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
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

function syncStorage() {
	const o = {};
	for (const [k, v] of storageRows) if (k.trim()) o[k.trim()] = v.trim();
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
		if (/^[[{]/.test(v.trim())) {
			try {
				JSON.parse(v);
			} catch (e) {
				ok = false;
				bad.push(k.trim() || '(no key)');
			}
		}
		if (inputs[i]) inputs[i].classList.toggle('invalid', !ok);
	});
	$('storageErr').hidden = !bad.length;
	$('storageErr').textContent = bad.length ? 'Not valid JSON: ' + bad.join(', ') + '. Check for a missing bracket or an extra comma at the end.' : '';
	$('storageCount').textContent = Object.keys(project.localStorage || {}).length;
}

// ---- 5. pages ---------------------------------------------------------------------------------------

const OPEN_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>';

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

let pageRowEls = []; // the drawn rows [{p, tr, stepsRow, simHit}], for the search

function renderPages() {
	const rows = $('pageRows');
	rows.innerHTML = '';
	pageRowEls = [];
	const pages = project.pages || (project.pages = []);
	const accounts = (project.accounts || []).map(a => a.name);
	pages.forEach((p, i) => {
		const tr = el('tr', {class: p.skip ? 'off' : ''});
		const include = el('input', {type: 'checkbox', checked: !p.skip, onchange: e => { if (e.target.checked) delete p.skip; else p.skip = true; tr.className = p.skip ? 'off' : ''; markDirty(); updateAllBox(); }});
		const text = (k, ph) => el('input', {value: p[k] || '', placeholder: ph, oninput: e => { if (e.target.value) p[k] = e.target.value; else delete p[k]; markDirty(); }});
		const pathInput = text('path', '/page.html');
		const open = el('a', {class: 'icon-btn open-page', target: '_blank', rel: 'noopener', href: pageHref(p.path), title: 'Open in your browser (as a visitor; steps are not run)', 'aria-label': 'Open this page in your browser'});
		open.innerHTML = OPEN_ICON;
		pathInput.addEventListener('input', () => { open.href = pageHref(p.path); });
		const groupInput = text('group', 'Pages');
		groupInput.setAttribute('list', 'groupList');
		groupInput.addEventListener('change', refreshGroupList);
		const simHit = el('div', {class: 'sim-hit muted small', hidden: true});
		const acc = el('select', {onchange: e => { if (e.target.value) p.account = e.target.value; else delete p.account; markDirty(); }},
			el('option', {value: ''}, '—'), accounts.map(n => el('option', {value: n}, n)));
		acc.value = p.account || '';
		const stepsRow = el('tr', {class: 'steps-row', hidden: true});
		const ta = el('textarea', {rows: 5, placeholder: '[{"click": "#open-menu"}]'}, p.steps ? JSON.stringify(p.steps, null, '\t') : '');
		ta.oninput = () => {
			if (!ta.value.trim()) {
				delete p.steps;
				ta.style.borderColor = '';
				markDirty();
				refreshTags();
				return;
			}
			try {
				const v = JSON.parse(ta.value);
				if (!Array.isArray(v)) throw new Error();
				p.steps = v;
				ta.style.borderColor = '';
				markDirty();
			} catch (e) {
				ta.style.borderColor = 'var(--danger)';
			}
			refreshTags();
		};
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
		stepsRow.append(el('td'), el('td', {colspan: 5},
			el('div', {class: 'muted small'}, 'Steps before the capture (click, fill, select, check, press, hover, wait, waitFor, waitForUrl, eval, reload; see docs/PLAN.md). Steps starting with "goto" replace the address.'), ta,
			el('div', {class: 'muted small page-screens-label'}, 'Screens for this page (none ticked = all of them). A state that clicks a burger button only works on the sizes where the burger shows.'),
			screenBox));
		const tagBox = el('span', {class: 'tags'});
		const more = el('button', {class: 'icon-btn', type: 'button', title: 'Steps and screens for this page', onclick: () => { stepsRow.hidden = !stepsRow.hidden; }}, '⋯');
		function refreshTags() {
			const tags = [];
			if (p.similar && p.similar.length) tags.push(el('span', {class: 'tag', title: p.similar.slice(0, 10).join('\n')}, '+' + p.similar.length + ' similar'));
			if (p.steps) tags.push(el('span', {class: 'tag'}, 'steps'));
			if (p.screens) tags.push(el('span', {class: 'tag', title: 'Only on: ' + p.screens.join(', ')}, 'some screens'));
			if (p.variants) tags.push(el('span', {class: 'tag', title: 'Only for: ' + p.variants.join(', ')}, 'some variants'));
			tagBox.replaceChildren(...tags);
			more.className = 'icon-btn' + (p.steps || p.screens ? ' on' : '');
		}
		refreshTags();
		tr.append(
			el('td', {class: 'c-check'}, include),
			el('td', {}, text('name', 'Name')),
			el('td', {}, el('div', {class: 'addr'}, pathInput, open), simHit),
			el('td', {}, groupInput),
			el('td', {}, acc),
			el('td', {class: 'c-more'}, tagBox, more,
				el('button', {class: 'icon-btn', type: 'button', title: 'Duplicate as a new state (e.g. "menu open")', onclick: () => { pages.splice(i + 1, 0, Object.assign(JSON.parse(JSON.stringify(p)), {name: (p.name || 'Page') + ' — state', steps: p.steps || []})); markDirty(); renderPages(); }}, '⧉'),
				el('button', {class: 'icon-btn danger', type: 'button', title: 'Remove from the list', onclick: () => { pages.splice(i, 1); markDirty(); renderPages(); }}, '×')));
		rows.append(tr, stepsRow);
		pageRowEls.push({p, tr, stepsRow, simHit});
	});
	$('noPages').hidden = pages.length > 0;
	refreshGroupList();
	applyPageFilter();
	updateSummary();
}

// the groups already used, offered while typing a group
function refreshGroupList() {
	const groups = [...new Set((project.pages || []).map(p => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
	const total = pageRowEls.length;
	$('pageTools').hidden = !total;
	$('pageSearchInfo').textContent = !q ? '' : shown ? shown + ' of ' + total + ' shown' : 'No page matches “' + raw + '”';
	$('setGroupBtn').textContent = q ? 'Set group for the ' + shown + ' shown…' : 'Set group for all ' + total + '…';
	$('setGroupBtn').disabled = !shown;
	updateAllBox();
}

function shownPages() {
	return pageRowEls.filter(r => !r.tr.classList.contains('filtered')).map(r => r.p);
}

function closeGroupForm() {
	$('setGroupForm').hidden = true;
	$('setGroupBtn').hidden = false;
}

// one group for every page shown (all of them without a search); in Figma a group can be its own section
function applyGroup() {
	const g = $('setGroupInput').value.trim();
	if (!g) return $('setGroupInput').focus();
	const list = pageQuery() ? shownPages() : project.pages || [];
	if (!pageQuery() && list.length > 1 && !confirm('Put all ' + list.length + ' pages in the group "' + g + '"?')) return;
	for (const p of list) p.group = g;
	closeGroupForm();
	markDirty();
	renderPages();
}

$('pageSearch').addEventListener('input', applyPageFilter);
$('pageSearch').addEventListener('keydown', e => {
	if (e.key === 'Escape' && e.target.value) {
		e.preventDefault();
		e.target.value = '';
		applyPageFilter();
	}
});
$('setGroupBtn').onclick = () => {
	$('setGroupBtn').hidden = true;
	$('setGroupForm').hidden = false;
	$('setGroupInput').value = '';
	$('setGroupInput').focus();
};
$('setGroupCancel').onclick = closeGroupForm;
$('setGroupApply').onclick = applyGroup;
$('setGroupInput').addEventListener('keydown', e => {
	if (e.key === 'Enter') applyGroup();
	if (e.key === 'Escape') closeGroupForm();
});

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
}

function onCrawlEvent(ev) {
	if (ev.type === 'log') {
		$('crawlLog').textContent += ev.text + '\n';
		$('crawlLog').scrollTop = 1e9;
	}
}

async function findPages() {
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
	const dims = (project.dimensions || []).filter(d => d.options && d.options.length);
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
	$('captureSummary').textContent = pages + ' page(s) × ' + s + ' screen(s)' + (v > 1 ? ' × ' + v + ' variants' : '') + ' ≈ ' + frames + ' frames';
	$('captureBtn').disabled = busy || !pages;
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
	try {
		const r = await call('POST', '/api/projects', {name: $('npName').value.trim(), source});
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
$('newProject').onclick = showNewForm;
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
	await loadProjects();
};
$('addCustom').onclick = () => {
	project.screens = (project.screens || []).concat({name: 'Custom', width: 1200, height: 800});
	markDirty();
	renderCustomScreens();
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
$('addPage').onclick = () => {
	$('pageSearch').value = ''; // the new row must be visible
	project.pages = (project.pages || []).concat({name: '', path: '/', group: 'Pages'});
	markDirty();
	renderPages();
	const inputs = $('pageRows').querySelectorAll('tr:not(.steps-row) td:nth-child(2) input');
	inputs[inputs.length - 1].focus();
};
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
