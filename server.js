// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// server.js — the html2frame control panel (D1): http://localhost:5600, bound to 127.0.0.1 only.
// Serves panel/ and a small JSON API: projects, a folder browser, test logins, crawling ("Find pages") and
// capturing as background jobs with live progress (Server-Sent Events), and the capture files, including
// /api/captures/latest for the Figma plugin's "Latest from panel" (D7).
// Usage: node server.js [--open] [--port 5600]

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {capture, loadSettings, launchBrowser, newContext} = require('./src/capture');
const {crawl, mergePages} = require('./src/crawl');
const {resolveScreens, PRESETS} = require('./src/screens');
const staticServer = require('./src/static-server');
const {trashFiles} = require('./src/trash');

const ROOT = __dirname;
const PROJECTS = path.join(ROOT, 'projects');
const CAPTURES = path.join(ROOT, 'captures');
const PANEL = path.join(ROOT, 'panel');
const PLUGIN_MANIFEST = path.join(ROOT, 'figma-plugin', 'manifest.json');
const args = process.argv.slice(2);
const PORT = Number((args[args.indexOf('--port') + 1] || '').match(/^\d+$/) ? args[args.indexOf('--port') + 1] : 5600);
const HOSTS = new Set(['localhost:' + PORT, '127.0.0.1:' + PORT]);

fs.mkdirSync(PROJECTS, {recursive: true});
fs.mkdirSync(CAPTURES, {recursive: true});

// ---- helpers ----------------------------------------------------------------------------------------

const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'};

function send(res, status, body, headers = {}) {
	const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
	res.writeHead(status, Object.assign({'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}, headers));
	res.end(isJson ? JSON.stringify(body) : body);
}

function fail(res, status, message) {
	send(res, status, {error: message});
}

function readBody(req, limit = 5e6) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', c => {
			size += c.length;
			if (size > limit) {
				reject(new Error('Request too large'));
				req.destroy();
			} else chunks.push(c);
		});
		req.on('end', () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
			} catch (e) {
				reject(new Error('Body is not JSON'));
			}
		});
		req.on('error', reject);
	});
}

// project names become file names: keep them simple
function projectFile(name) {
	if (!/^[\w][\w .-]{0,80}$/.test(name || '')) throw new Error('Project names may use letters, digits, spaces, "-", "_" and "."');
	return path.join(PROJECTS, name + '.json');
}

function slug(s) {
	return String(s || 'project').trim().replace(/[^\w .-]+/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, 80) || 'project';
}

function writeJson(file, data) {
	fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
}

function listProjects() {
	return fs.readdirSync(PROJECTS).filter(f => f.endsWith('.json')).sort().map(f => {
		const name = f.slice(0, -5);
		try {
			const s = JSON.parse(fs.readFileSync(path.join(PROJECTS, f), 'utf8'));
			return {name, title: s.name || name, source: s.source || {}, pages: (s.pages || []).length};
		} catch (e) {
			return {name, title: name, error: 'not valid JSON'};
		}
	});
}

function listCaptures() {
	return fs.readdirSync(CAPTURES).filter(f => f.endsWith('.json')).map(f => {
		const st = fs.statSync(path.join(CAPTURES, f));
		return {file: f, size: st.size, modified: st.mtime.toISOString()};
	}).sort((a, b) => b.modified.localeCompare(a.modified));
}

// ---- jobs: crawl and capture run in the background; the panel follows them over SSE ---------------

const jobs = new Map();
let running = null; // one browser job at a time

function startJob(kind, title, work) {
	if (running) throw Object.assign(new Error('Busy: ' + running.title + ' is still running.'), {status: 409});
	const job = {id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, title, status: 'running', events: [], listeners: new Set(), started: new Date().toISOString()};
	const emit = (type, data) => {
		const ev = Object.assign({type, t: Date.now()}, data);
		job.events.push(ev);
		if (job.events.length > 5000) job.events.splice(0, 1000);
		for (const l of job.listeners) l(ev);
	};
	jobs.set(job.id, job);
	running = job;
	Promise.resolve()
		.then(() => work(emit))
		.then(result => {
			job.status = 'done';
			emit('done', {result});
		})
		.catch(e => {
			job.status = 'failed';
			emit('error', {message: String(e && e.message || e)});
		})
		.finally(() => {
			if (running === job) running = null;
			for (const l of job.listeners) l(null);
		});
	return job;
}

function streamJob(req, res, job) {
	res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive'});
	const write = ev => res.write('data: ' + JSON.stringify(ev) + '\n\n');
	for (const ev of job.events) write(ev);
	if (job.status !== 'running') return res.end();
	const listener = ev => (ev ? write(ev) : res.end());
	job.listeners.add(listener);
	const ping = setInterval(() => res.write(': ping\n\n'), 15000);
	req.on('close', () => {
		clearInterval(ping);
		job.listeners.delete(listener);
	});
}

// ---- actions ----------------------------------------------------------------------------------------

function settingsFor(name) {
	const file = projectFile(name);
	if (!fs.existsSync(file)) throw Object.assign(new Error('No project "' + name + '"'), {status: 404});
	return loadSettings(file);
}

// open a login page and find its e-mail/user field, password field and submit button, as CSS selectors
async function detectLogin(settings, loginPage) {
	const source = settings.source || {};
	let server = null, browser = null;
	try {
		let origin;
		if (source.folder) {
			server = await staticServer.start(source.folder);
			origin = server.origin;
		} else if (source.url) origin = new URL(source.url).origin;
		else throw new Error('The project has no folder or URL.');
		browser = await launchBrowser(() => {});
		const context = await browser.newContext({viewport: {width: 1440, height: 900}});
		const page = await context.newPage();
		await page.goto(new URL(loginPage || '/login.html', origin + '/').href, {waitUntil: 'load'});
		await page.waitForLoadState('networkidle', {timeout: 5000}).catch(() => {});
		return await page.evaluate(() => {
			const visible = e => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
			// a short selector that finds exactly this element
			const sel = e => {
				if (!e) return '';
				if (e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) return '#' + CSS.escape(e.id);
				const tag = e.tagName.toLowerCase();
				for (const a of ['name', 'type', 'data-testid', 'aria-label', 'placeholder']) {
					const v = e.getAttribute(a);
					if (v) {
						const s = tag + '[' + a + '="' + v.replace(/"/g, '\\"') + '"]';
						if (document.querySelectorAll(s).length === 1) return s;
					}
				}
				const form = e.form ? (e.form.id ? '#' + CSS.escape(e.form.id) + ' ' : 'form ') : '';
				return form + tag + (e.type ? '[type="' + e.type + '"]' : '');
			};
			const inputs = [...document.querySelectorAll('input')].filter(visible);
			const pass = inputs.find(i => i.type === 'password');
			const scope = pass && pass.form ? [...pass.form.querySelectorAll('input')].filter(visible) : inputs;
			const user = scope.find(i => i.type === 'email') || scope.find(i => /mail|user|login|phone/i.test((i.name || '') + (i.id || '') + (i.autocomplete || ''))) || scope.find(i => i.type === 'text');
			const root = pass && pass.form ? pass.form : document;
			const submit = [...root.querySelectorAll('button[type=submit], input[type=submit], button:not([type])')].find(visible) || [...root.querySelectorAll('button')].find(b => visible(b) && /log ?in|sign ?in|enter|submit|մուտք|войти/i.test(b.textContent));
			return {found: !!(user && pass), userField: sel(user), passField: sel(pass), submit: sel(submit), title: document.title};
		});
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (server) await server.close();
	}
}

// log in with one account and return where it landed, with a small screenshot
async function testLogin(settings, accountName) {
	const account = (settings.accounts || []).find(a => a.name === accountName);
	if (!account) throw new Error('No account "' + accountName + '"');
	const source = settings.source || {};
	let server = null, browser = null;
	try {
		let origin;
		if (source.folder) {
			server = await staticServer.start(source.folder);
			origin = server.origin;
		} else if (source.url) origin = new URL(source.url).origin;
		else throw new Error('The project has no folder or URL.');
		browser = await launchBrowser(() => {});
		const screen = resolveScreens(['desktop'], 'portrait')[0];
		const info = {};
		const site = {origin, query: {}};
		let context;
		try {
			context = await newContext(browser, screen, {name: null}, account, site, info);
		} catch (e) {
			return {ok: false, error: e.message.split('\n')[0]};
		}
		const page = await context.newPage();
		await page.goto(new URL(info.landing || '/', origin + '/').href, {waitUntil: 'load'});
		await page.waitForTimeout(500);
		const shot = (await page.screenshot({type: 'jpeg', quality: 60})).toString('base64');
		return {ok: true, landing: info.landing, shot};
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (server) await server.close();
	}
}

// The system's own folder window (Explorer on Windows, Finder on macOS, zenity/kdialog on Linux).
// Resolves {path} or {cancelled: true}; rejects when the system has no such window (the panel then shows its list).
const PICK_FOLDER_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class H2fPicker {
	[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
	[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IShellItem {
		void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
		void GetParent(out IShellItem ppsi);
		void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
		void GetAttributes(uint mask, out uint attribs);
		void Compare(IShellItem psi, uint hint, out int order);
	}
	[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IFileDialog {
		[PreserveSig] int Show(IntPtr parent);
		void SetFileTypes(uint n, IntPtr specs);
		void SetFileTypeIndex(uint i);
		void GetFileTypeIndex(out uint i);
		void Advise(IntPtr events, out uint cookie);
		void Unadvise(uint cookie);
		void SetOptions(uint fos);
		void GetOptions(out uint fos);
		void SetDefaultFolder(IShellItem psi);
		void SetFolder(IShellItem psi);
		void GetFolder(out IShellItem psi);
		void GetCurrentSelection(out IShellItem psi);
		void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
		void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
		void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
		void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
		void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
		void GetResult(out IShellItem psi);
	}
	[DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
	static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem item);
	[DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
	[DllImport("user32.dll")] static extern bool SetProcessDPIAware();
	public static string Pick(string start) {
		// PowerShell is not DPI-aware, so on a scaled display (125 %, 150 %) Windows would stretch the window
		// and it looks blurry; per-monitor aware (-4) keeps it sharp. Older Windows: system aware.
		try {
			if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware();
		} catch (Exception) {
			try { SetProcessDPIAware(); } catch (Exception) {}
		}
		IFileDialog d = (IFileDialog) new FileOpenDialog();
		d.SetOptions(0x20 | 0x40 | 0x800); // pick folders, file system only, path must exist
		d.SetTitle("Choose the folder with your HTML files");
		d.SetOkButtonLabel("Use this folder");
		if (!String.IsNullOrEmpty(start)) start = start.Replace('/', (char) 92); // 92 = backslash
		if (!String.IsNullOrEmpty(start) && System.IO.Directory.Exists(start)) {
			try {
				Guid g = typeof(IShellItem).GUID;
				IShellItem folder;
				SHCreateItemFromParsingName(start, IntPtr.Zero, ref g, out folder);
				d.SetFolder(folder);
			} catch (Exception) {} // a start folder it cannot open: just open the window elsewhere
		}
		// an invisible top-most owner, so the window opens in front of the browser
		using (Form owner = new Form { TopMost = true, ShowInTaskbar = false, Opacity = 0, StartPosition = FormStartPosition.CenterScreen }) {
			owner.Show();
			owner.Activate();
			int hr = d.Show(owner.Handle);
			if (hr != 0) return null;
		}
		IShellItem result;
		d.GetResult(out result);
		string path;
		result.GetDisplayName(0x80058000, out path);
		return path;
	}
}
'@
$p = [H2fPicker]::Pick($env:H2F_START)
if ($p) { Write-Output ('PATH:' + $p) } else { Write-Output 'CANCELLED' }
`;

function pickFolder(start) {
	return new Promise((resolve, reject) => {
		let cmd, cmdArgs, env = process.env;
		if (process.platform === 'win32') {
			cmd = 'powershell.exe';
			cmdArgs = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PICK_FOLDER_PS, 'utf16le').toString('base64')];
			env = Object.assign({}, process.env, {H2F_START: start ? path.resolve(start) : ''});
		} else if (process.platform === 'darwin') {
			// shown by the frontmost app (the browser), so it opens in front
			const loc = start && fs.existsSync(start) ? ' default location (POSIX file ' + JSON.stringify(path.resolve(start)) + ')' : '';
			cmd = 'osascript';
			cmdArgs = ['-e', 'tell application (path to frontmost application as text) to POSIX path of (choose folder with prompt "Choose the folder with your HTML files"' + loc + ')'];
		} else {
			cmd = 'zenity';
			cmdArgs = ['--file-selection', '--directory', '--title=Choose the folder with your HTML files'].concat(start ? ['--filename=' + path.resolve(start) + '/'] : []);
		}
		const run = (c, a) => {
			const child = spawn(c, a, {env, windowsHide: true});
			let out = '', err = '';
			child.stdout.on('data', d => { out += d; });
			child.stderr.on('data', d => { err += d; });
			child.on('error', e => {
				if (c === 'zenity') return run('kdialog', ['--getexistingdirectory', start || os.homedir()]);
				reject(new Error('No folder window available (' + e.message + ')'));
			});
			child.on('close', code => {
				const text = out.trim();
				if (process.platform === 'win32') {
					const m = text.match(/PATH:(.*)$/m);
					if (m) return resolve({path: m[1].trim()});
					if (/CANCELLED/.test(text)) return resolve({cancelled: true});
					return reject(new Error(err.trim().split('\n')[0] || 'The folder window could not be opened'));
				}
				if (code === 0 && text) return resolve({path: text.replace(/\/$/, '') || '/'});
				// osascript: "User canceled" (-128); zenity/kdialog: exit code 1
				if (/-128|cancel/i.test(err) || code === 1) return resolve({cancelled: true});
				reject(new Error(err.trim().split('\n')[0] || 'The folder window could not be opened'));
			});
		};
		run(cmd, cmdArgs);
	});
}

// folders for the "Browse…" helper; drive letters on Windows when no path is given
function browse(p) {
	if (!p) {
		if (process.platform === 'win32') {
			const drives = [];
			for (let c = 67; c <= 90; c++) {
				const d = String.fromCharCode(c) + ':\\';
				if (fs.existsSync(d)) drives.push({name: d, path: d});
			}
			return {path: '', parent: null, dirs: drives, home: os.homedir(), html: 0};
		}
		p = os.homedir();
	}
	const full = path.resolve(p);
	const entries = fs.readdirSync(full, {withFileTypes: true});
	const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => ({name: e.name, path: path.join(full, e.name)})).sort((a, b) => a.name.localeCompare(b.name));
	const parent = path.dirname(full) === full ? '' : path.dirname(full);
	return {path: full, parent, dirs, home: os.homedir(), html: entries.filter(e => e.isFile() && /\.html?$/i.test(e.name)).length};
}

// copy an example into projects/ (folder made absolute, so it works from there)
function copyExample(file) {
	const src = path.join(ROOT, 'examples', path.basename(file));
	if (!fs.existsSync(src)) throw new Error('No example ' + file);
	const s = JSON.parse(fs.readFileSync(src, 'utf8'));
	if (s.source && s.source.folder) s.source.folder = path.resolve(path.dirname(src), s.source.folder).split(path.sep).join('/');
	const name = slug(s.name || path.basename(file, '.json'));
	const out = projectFile(name);
	if (fs.existsSync(out)) throw Object.assign(new Error('A project "' + name + '" already exists.'), {status: 409});
	writeJson(out, s);
	return name;
}

// ---- routes -----------------------------------------------------------------------------------------

async function api(req, res, url) {
	const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // after "api"
	const m = req.method;

	if (parts[0] === 'info' && m === 'GET') {
		return send(res, 200, {presets: PRESETS, running: running && {id: running.id, kind: running.kind, title: running.title}, examples: fs.readdirSync(path.join(ROOT, 'examples')).filter(f => f.endsWith('.settings.json')),
			platform: process.platform, port: PORT, pluginManifest: PLUGIN_MANIFEST});
	}

	// Help page: show the plugin's manifest.json in Explorer / Finder, for Figma's "Import plugin from manifest…"
	if (parts[0] === 'reveal-plugin' && m === 'POST') {
		reveal(PLUGIN_MANIFEST);
		return send(res, 200, {shown: PLUGIN_MANIFEST});
	}

	if (parts[0] === 'projects') {
		if (parts.length === 1 && m === 'GET') return send(res, 200, listProjects());
		if (parts.length === 1 && m === 'POST') {
			const body = await readBody(req);
			if (body.example) return send(res, 201, {name: copyExample(body.example)});
			const name = slug(body.name);
			const file = projectFile(name);
			if (fs.existsSync(file)) return fail(res, 409, 'A project "' + name + '" already exists.');
			const s = {name: body.name || name, source: body.source || {}, start: body.start || '/index.html', screens: ['desktop'], orientation: 'portrait', variants: [], accounts: [], pages: []};
			writeJson(file, s);
			return send(res, 201, {name});
		}
		const file = projectFile(parts[1]);
		// rename the project file after its name: POST /api/projects/:name/rename {to}
		if (parts[2] === 'rename' && m === 'POST') {
			const body = await readBody(req);
			const to = slug(body.to);
			if (to === parts[1]) return send(res, 200, {name: to});
			if (!fs.existsSync(file)) return fail(res, 404, 'No project "' + parts[1] + '"');
			const target = projectFile(to);
			if (fs.existsSync(target)) return fail(res, 409, 'a project "' + to + '" already exists');
			fs.renameSync(file, target);
			return send(res, 200, {name: to});
		}
		if (m === 'GET') {
			if (!fs.existsSync(file)) return fail(res, 404, 'No project "' + parts[1] + '"');
			return send(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
		}
		if (m === 'PUT') {
			const body = await readBody(req);
			if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, 400, 'Expected a settings object');
			writeJson(file, body);
			return send(res, 200, {saved: true});
		}
		if (m === 'DELETE') {
			// not gone for good: moved to projects/deleted/ (git-ignored too), where it can be restored by hand
			if (fs.existsSync(file)) {
				const bin = path.join(PROJECTS, 'deleted');
				fs.mkdirSync(bin, {recursive: true});
				const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
				fs.renameSync(file, path.join(bin, parts[1] + ' ' + stamp + '.json'));
			}
			return send(res, 200, {deleted: true, movedTo: 'projects/deleted/'});
		}
	}

	if (parts[0] === 'pick-folder' && m === 'POST') {
		const body = await readBody(req);
		try {
			return send(res, 200, await pickFolder(body.start || ''));
		} catch (e) {
			return send(res, 200, {unavailable: true, error: e.message});
		}
	}

	if (parts[0] === 'browse' && m === 'GET') {
		try {
			return send(res, 200, browse(url.searchParams.get('path') || ''));
		} catch (e) {
			return fail(res, 400, 'Cannot open that folder: ' + e.message);
		}
	}

	if (parts[0] === 'detect-login' && m === 'POST') {
		const body = await readBody(req);
		if (running) return fail(res, 409, 'Busy: ' + running.title + ' is still running.');
		return send(res, 200, await detectLogin(settingsFor(body.project), body.page));
	}

	if (parts[0] === 'test-login' && m === 'POST') {
		const body = await readBody(req);
		const settings = body.settings ? Object.assign({}, body.settings) : settingsFor(body.project);
		if (settings.source && settings.source.folder) settings.source.folder = path.resolve(PROJECTS, settings.source.folder);
		if (running) return fail(res, 409, 'Busy: ' + running.title + ' is still running.');
		return send(res, 200, await testLogin(settings, body.account));
	}

	if (parts[0] === 'crawl' && m === 'POST') {
		const body = await readBody(req);
		const settings = settingsFor(body.project);
		const job = startJob('crawl', 'Find pages for ' + body.project, async emit => {
			const r = await crawl(settings, {depth: body.depth, max: body.max, log: text => emit('log', {text})});
			let added = null;
			if (body.save) {
				const file = projectFile(body.project);
				const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
				const found = r.pages.concat(body.unlinked ? r.unlinked : []);
				const merged = mergePages(raw.pages, found);
				raw.pages = merged.pages;
				writeJson(file, raw);
				added = merged.added;
			}
			return {pages: r.pages, unlinked: r.unlinked, truncated: r.truncated, added};
		});
		return send(res, 202, {job: job.id});
	}

	if (parts[0] === 'capture' && m === 'POST') {
		const body = await readBody(req);
		const settings = settingsFor(body.project);
		const job = startJob('capture', 'Capture of ' + body.project, async emit => {
			const r = await capture(settings, {
				screens: body.screens, orientation: body.orientation, pages: body.pages,
				log: text => emit('log', {text}),
				onProgress: p => emit('progress', p),
			});
			return {file: r.file && path.basename(r.file), captures: r.data.captures.length, failures: r.failures, size: r.file ? fs.statSync(r.file).size : 0};
		});
		return send(res, 202, {job: job.id});
	}

	// /api/jobs/:id/events (and /api/capture/:id/events, as in the plan)
	if ((parts[0] === 'jobs' || parts[0] === 'capture' || parts[0] === 'crawl') && parts[2] === 'events' && m === 'GET') {
		const job = jobs.get(parts[1]);
		if (!job) return fail(res, 404, 'No such job');
		return streamJob(req, res, job);
	}

	if (parts[0] === 'captures' && m === 'GET') {
		if (parts.length === 1) return send(res, 200, listCaptures());
		// the plugin's "Latest from panel": its iframe has an opaque origin, so CORS is open for these two
		const cors = {'Access-Control-Allow-Origin': '*'};
		const file = parts[1] === 'latest' ? (listCaptures()[0] || {}).file : path.basename(parts[1]);
		if (!file || !fs.existsSync(path.join(CAPTURES, file))) return send(res, 404, {error: 'No captures yet'}, cors);
		res.writeHead(200, Object.assign({'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Capture-File': file},
			url.searchParams.has('download') ? {'Content-Disposition': 'attachment; filename="' + file + '"'} : {}, cors));
		return fs.createReadStream(path.join(CAPTURES, file)).pipe(res);
	}

	// remove one capture (/api/captures/:file) or all of them (/api/captures): moved to the recycle bin / Trash.
	// Panel only: the OPTIONS preflight allows GET alone, so no other page can send this.
	if (parts[0] === 'captures' && m === 'DELETE') {
		if (running) return fail(res, 409, 'Busy: ' + running.title + ' is still running.');
		let files;
		if (parts.length === 1) {
			files = listCaptures().map(c => c.file);
		} else {
			const file = path.basename(parts[1]);
			if (file !== parts[1] || !file.endsWith('.json') || !fs.existsSync(path.join(CAPTURES, file))) return fail(res, 404, 'No such capture');
			files = [file];
		}
		const r = await trashFiles(files.map(f => path.join(CAPTURES, f)));
		return send(res, r.failed.length ? 500 : 200, {
			removed: r.removed.length,
			failed: r.failed.map(x => ({file: path.basename(x.file), error: x.error})),
			error: r.failed.length ? r.failed.length + ' file(s) could not be moved to the ' + (process.platform === 'win32' ? 'Recycle Bin' : 'Trash') + ': ' + r.failed[0].error : undefined,
		});
	}

	return fail(res, 404, 'Unknown API ' + m + ' ' + url.pathname);
}

const server = http.createServer(async (req, res) => {
	// only this computer, by name too (a web page cannot reach the panel through another host name)
	if (!HOSTS.has(req.headers.host)) return fail(res, 403, 'Use http://localhost:' + PORT);
	const url = new URL(req.url, 'http://localhost');
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET',
			'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Private-Network': 'true',
		});
		return res.end();
	}
	try {
		if (url.pathname.startsWith('/api/')) return await api(req, res, url);
		if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');
		if (url.pathname === '/license') return send(res, 200, fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
		// /assets/… (the logo) from the project's assets folder, /images/… (README screenshots, for the Help page)
		// from docs/images; everything else from panel/
		const dir = (url.pathname.match(/^\/(assets|images)\//) || [])[1];
		const base = dir === 'assets' ? path.join(ROOT, 'assets') : dir === 'images' ? path.join(ROOT, 'docs', 'images') : PANEL;
		const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(dir ? dir.length + 2 : 1));
		const file = path.join(base, path.normalize(rel));
		if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, 'Not found');
		res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
		fs.createReadStream(file).pipe(res);
	} catch (e) {
		fail(res, e.status || 500, String(e && e.message || e));
	}
});

// selects the file in Explorer / Finder (Linux: opens its folder)
function reveal(file) {
	// Explorer wants /select,"path" exactly as written (Node's own quoting of the whole argument is not understood)
	const cmd = process.platform === 'win32' ? ['explorer.exe', ['/select,"' + file + '"']] : process.platform === 'darwin' ? ['open', ['-R', file]] : ['xdg-open', [path.dirname(file)]];
	spawn(cmd[0], cmd[1], {detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32'}).on('error', () => {}).unref();
}

function openBrowser(u) {
	const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
	spawn(cmd[0], cmd[1], {detached: true, stdio: 'ignore'}).unref();
}

server.on('error', e => {
	if (e.code === 'EADDRINUSE') {
		console.log('The panel is already running on http://localhost:' + PORT);
		if (args.includes('--open')) openBrowser('http://localhost:' + PORT);
		process.exit(0);
	}
	throw e;
});

server.listen(PORT, '127.0.0.1', () => {
	const u = 'http://localhost:' + PORT;
	console.log('html2frame control panel: ' + u + '  (Ctrl+C to stop)');
	if (args.includes('--open')) openBrowser(u);
});
