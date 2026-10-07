// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// capture.js — Playwright runner: opens every page of a project at every screen size, waits until it has
// rendered, runs src/extract.js in it and writes a FORMAT v1 capture file (docs/FORMAT.md).
// Also a CLI: node src/capture.js projects/x.json [--screens desktop,phone] [--orientation both] [--pages "Home,Log In"] [--out file]

const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright-core');
const {resolveScreens} = require('./screens');
const staticServer = require('./static-server');
const {gotoPath, runSteps, stepKind} = require('./steps');

const ROOT = path.join(__dirname, '..');
const EXTRACT_JS = path.join(__dirname, 'extract.js');
const TIMEOUT = 15000;

function loadSettings(file) {
	const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (settings.source && settings.source.folder) settings.source.folder = path.resolve(path.dirname(file), settings.source.folder);
	return settings;
}

// ---- folder shortcut: settings made from a folder of .html files ----------------------------------

const SKIP_DIRS = /^(\.|node_modules$|bower_components$|vendor$)/;
const MAX_PAGES = 200;

function listHtml(root) {
	const out = [];
	(function walk(dir, depth) {
		if (depth > 5 || out.length >= MAX_PAGES) return;
		const entries = fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name));
		for (const e of entries) {
			if (out.length >= MAX_PAGES) return;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (!SKIP_DIRS.test(e.name)) walk(full, depth + 1);
			} else if (/\.html?$/i.test(e.name)) out.push(full);
		}
	})(root, 0);
	return out;
}

// "Policies — InsureNow" -> "Policies" (empty if there is no <title>)
function titleName(file) {
	let title = '';
	try {
		const m = fs.readFileSync(file, 'utf8').slice(0, 20000).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		if (m) title = m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
	} catch (e) {}
	return title.split(/\s+[—–|]\s+|\s+-\s+/)[0].trim();
}

// "about-us.html" -> "About us", "index.html" -> "Home"
function fileName(file) {
	const base = path.basename(file).replace(/\.html?$/i, '');
	return base === 'index' ? 'Home' : base.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());
}

// A project folder -> settings with every .html file as a page (index.html first, grouped by subfolder).
function settingsFromFolder(folder) {
	const root = path.resolve(folder);
	const files = listHtml(root);
	if (!files.length) throw new Error('No .html files found in ' + root);
	const rel = f => '/' + path.relative(root, f).split(path.sep).join('/');
	files.sort((a, b) => {
		const ra = rel(a), rb = rel(b);
		const da = ra.split('/').length, db = rb.split('/').length;
		if (da !== db) return da - db; // top level first
		const ia = /\/index\.html?$/i.test(ra), ib = /\/index\.html?$/i.test(rb);
		return ia !== ib ? (ia ? -1 : 1) : ra.localeCompare(rb);
	});
	// a title shared by several pages is usually just the site name: use the file name for those
	const titles = files.map(titleName);
	const count = {};
	titles.forEach(t => { count[t] = (count[t] || 0) + 1; });
	const seen = {};
	const pages = files.map((f, i) => {
		const p = rel(f);
		const parts = p.split('/');
		let name = titles[i] && count[titles[i]] === 1 ? titles[i] : fileName(f);
		if (seen[name]) name += ' (' + p.slice(1) + ')'; // still the same, e.g. index.html in two folders
		seen[name] = true;
		const group = parts.length > 2 ? parts[1].replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Pages';
		return {name, path: p, group};
	});
	const start = pages[0].path;
	return {name: path.basename(root), source: {folder: root.split(path.sep).join('/')}, start, screens: ['desktop'], orientation: 'portrait', pages};
}

// The installed Edge, else the installed Chrome (no browser download).
async function launchBrowser(log) {
	const errors = [];
	for (const channel of ['msedge', 'chrome']) {
		try {
			const browser = await chromium.launch({channel, headless: true});
			log('Browser: ' + channel + ' ' + browser.version());
			return browser;
		} catch (e) {
			errors.push(channel + ': ' + String(e.message).split('\n')[0]);
		}
	}
	throw new Error('Could not start Microsoft Edge or Google Chrome. Install one of them.\n' + errors.join('\n'));
}

function slug(s) {
	return String(s || 'capture').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'capture';
}

function stamp(d) {
	const p = n => String(n).padStart(2, '0');
	return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

function outFile(project, now) {
	const dir = path.join(ROOT, 'captures');
	fs.mkdirSync(dir, {recursive: true});
	const base = path.join(dir, slug(project) + '-' + stamp(now));
	let file = base + '.json';
	for (let i = 2; fs.existsSync(file); i++) file = base + '-' + i + '.json';
	return file;
}

// ---- browser contexts -------------------------------------------------------------------------------

// info (optional) receives {landing: path} where the login ended, e.g. the dashboard (used by crawl.js)
async function newContext(browser, screen, variant, account, site, info) {
	const context = await browser.newContext({
		viewport: {width: screen.width, height: screen.height},
		deviceScaleFactor: 1,
		isMobile: !!screen.mobile,
		hasTouch: !!screen.mobile,
	});
	context.setDefaultTimeout(TIMEOUT);
	const ls = {};
	for (const [k, v] of Object.entries(variant.localStorage || {})) ls[k] = typeof v === 'string' ? v : JSON.stringify(v);
	if (Object.keys(ls).length) {
		// set if missing, so a page's own changes (e.g. a language switch) survive reloads
		await context.addInitScript(values => {
			try {
				for (const [k, v] of Object.entries(values)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
			} catch (e) {}
		}, ls);
	}
	if (variant.cookies && variant.cookies.length) {
		await context.addCookies(variant.cookies.map(c => Object.assign(c.domain || c.path ? {} : {url: site.origin}, c, {value: String(c.value)})));
	}
	if (account) {
		const page = await context.newPage();
		try {
			await runSteps(page, account.login, site);
			if (info) {
				const u = new URL(page.url());
				info.landing = u.pathname + u.search;
			}
		} catch (e) {
			await context.close();
			throw new Error('Login "' + account.name + '" failed: ' + e.message);
		} finally {
			if (!page.isClosed()) await page.close();
		}
	}
	return context;
}

// ---- one page ---------------------------------------------------------------------------------------

// ready: shared by the pages of one run, {misses, off}. A "Ready when" that never comes true (e.g. copied from
// another project) does not fail the page: it is captured anyway with a warning, and after two misses in a
// row the run stops waiting for it, instead of losing 15 s on every page.
async function settle(page, settings, ready, warn) {
	await page.waitForLoadState('load');
	await page.waitForLoadState('networkidle', {timeout: 5000}).catch(() => {});
	if (settings.readyWhen && !(ready && ready.off)) {
		// interval polling: requestAnimationFrame never fires in hidden tabs (RESEARCH §4)
		const ok = await page.waitForFunction(settings.readyWhen, null, {polling: 100, timeout: TIMEOUT}).then(() => true, () => false);
		if (ok) {
			if (ready) ready.misses = 0;
		} else {
			(warn || (() => {}))('"Ready when" was not true after ' + TIMEOUT / 1000 + ' s (' + settings.readyWhen + '); captured anyway');
			if (ready && ++ready.misses >= 2) {
				ready.off = true;
				(warn || (() => {}))('"Ready when" missed twice in a row: not waiting for it for the rest of this run. Check Project → Advanced.');
			}
		}
	}
	await page.evaluate(() => document.fonts.ready.then(() => true));
	await page.waitForTimeout(settings.settleMs ?? 300);
}

// Scroll down one viewport at a time so lazy images load, wait for them, then go back to the top.
async function scrollThrough(page) {
	await page.evaluate(async () => {
		const pause = ms => new Promise(r => setTimeout(r, ms));
		const height = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
		for (let y = 0; y < height() && y < 50000; y += innerHeight) {
			scrollTo(0, y);
			await pause(60);
		}
		scrollTo(0, 0);
		const pending = [...document.images].filter(im => !im.complete).map(im => new Promise(r => {
			im.addEventListener('load', r, {once: true});
			im.addEventListener('error', r, {once: true});
		}));
		await Promise.race([Promise.all(pending), pause(3000)]);
		await pause(60);
	});
}

async function capturePage(page, entry, settings, site, warn) {
	const steps = entry.steps || [];
	if (stepKind(steps[0]) !== 'goto') {
		if (!entry.path) throw new Error('Page has no "path" and its steps do not start with "goto".');
		await gotoPath(page, entry.path, site);
		// e.g. a page that needs a login sends you back to the login page
		const want = new URL(entry.path, site.origin + '/').pathname, got = new URL(page.url()).pathname;
		if (!steps.length && got !== want) warn('opened ' + want + ' but landed on ' + got + ' (redirect; is a login missing or failing?)');
	}
	await runSteps(page, steps, site);
	await settle(page, settings, site.ready, warn);
	await scrollThrough(page);
	const innerWidth = await page.evaluate(() => innerWidth);
	if (!(await page.evaluate(() => !!window.__html2frame))) await page.evaluate(fs.readFileSync(EXTRACT_JS, 'utf8'));
	const result = await page.evaluate(o => window.__html2frame.extract(o), {replaceText: settings.replaceText || {}});
	const u = new URL(page.url());
	return Object.assign(result, {url: u.pathname + u.search, innerWidth});
}

// ---- images -----------------------------------------------------------------------------------------

function sniff(buf, contentType) {
	if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
	if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
	if (buf.length > 2 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
	const head = buf.subarray(0, 1024).toString('utf8');
	if (/svg/.test(contentType || '') || /<svg[\s>]/i.test(head)) return 'image/svg+xml';
	return (contentType || 'application/octet-stream').split(';')[0].trim();
}

async function fetchImage(src, context) {
	if (src.startsWith('data:')) {
		const m = src.match(/^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s);
		if (!m) throw new Error('bad data: URL');
		const buf = /;base64/i.test(m[2]) ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
		return {buf, type: sniff(buf, m[1])};
	}
	const res = await context.request.get(src, {timeout: TIMEOUT});
	if (!res.ok()) throw new Error('HTTP ' + res.status());
	const buf = await res.body();
	return {buf, type: sniff(buf, res.headers()['content-type'])};
}

// SVG text -> markup sized to the box (parsed by the browser, so any valid SVG file works)
function sizeSvg(page, text, w, h) {
	return page.evaluate(([text, w, h]) => {
		const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
		const svg = doc.documentElement;
		if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
		const comments = [];
		const it = doc.createNodeIterator(svg, NodeFilter.SHOW_COMMENT);
		for (let n = it.nextNode(); n; n = it.nextNode()) comments.push(n);
		comments.forEach(n => n.remove());
		if (!svg.getAttribute('viewBox')) {
			const ow = parseFloat(svg.getAttribute('width')), oh = parseFloat(svg.getAttribute('height'));
			if (ow > 0 && oh > 0) svg.setAttribute('viewBox', '0 0 ' + ow + ' ' + oh);
		}
		svg.setAttribute('width', w);
		svg.setAttribute('height', h);
		return new XMLSerializer().serializeToString(svg);
	}, [text, w, h]);
}

// Any image the browser can decode -> PNG base64 (Figma's createImage only takes PNG, JPEG and GIF).
// w/h: draw size for vector sources; rasters keep their natural size.
function toPng(page, dataUrl, w, h) {
	return page.evaluate(async ([dataUrl, w, h]) => {
		const im = new Image();
		im.src = dataUrl;
		await im.decode();
		const vector = /^data:image\/svg/.test(dataUrl);
		const cw = Math.max(1, Math.round(vector ? w * 2 : im.naturalWidth)), ch = Math.max(1, Math.round(vector ? h * 2 : im.naturalHeight));
		const canvas = document.createElement('canvas');
		canvas.width = cw;
		canvas.height = ch;
		canvas.getContext('2d').drawImage(im, 0, 0, cw, ch);
		return canvas.toDataURL('image/png').split(',')[1];
	}, [dataUrl, w, h]);
}

const RASTER_OK = /^image\/(png|jpeg|gif)$/;

// Resolve every {src} in the tree: img nodes become {data} or t:"svg" nodes, frame image layers get {data}.
// canvas, video, iframe…: the extractor marks them (`shot`); a picture of each element becomes its image data.
// Fixed and sticky elements are hidden meanwhile, so a sticky header cannot cover what is being photographed.
async function takeShots(root, page, warn) {
	const nodes = [];
	(function walk(n) {
		if (n.shot) nodes.push(n);
		(n.ch || []).forEach(walk);
	})(root);
	if (!nodes.length) return;
	await page.evaluate(() => {
		for (const el of document.querySelectorAll('body *')) {
			const p = getComputedStyle(el).position;
			if ((p === 'fixed' || p === 'sticky') && !el.querySelector('[data-h2f-shot]') && !el.closest('[data-h2f-shot]')) el.setAttribute('data-h2f-hide', '');
		}
		const st = document.createElement('style');
		st.textContent = '[data-h2f-hide]{visibility:hidden!important}';
		document.head.appendChild(st);
	});
	for (const n of nodes) {
		try {
			const buf = await page.locator('[data-h2f-shot="' + n.shot + '"]').first().screenshot({type: 'png', timeout: 5000, animations: 'disabled'});
			n.data = buf.toString('base64');
		} catch (e) {
			warn('could not take a picture of the ' + n.n + ' (' + String(e.message).split('\n')[0] + ')');
		}
		delete n.shot;
	}
}

async function resolveImages(root, page, context, cache, warn) {
	const load = src => {
		if (!cache.has(src)) cache.set(src, fetchImage(src, context));
		return cache.get(src);
	};
	const short = src => (src.startsWith('data:') ? src.slice(0, 40) + '…' : src);

	async function imgNode(n) {
		let img;
		try {
			img = await load(n.src);
		} catch (e) {
			warn('image not loaded, skipped: ' + short(n.src) + ' (' + e.message + ')');
			return null;
		}
		const base = {n: n.n, x: n.x, y: n.y, w: n.w, h: n.h};
		if (img.type === 'image/svg+xml') {
			const svg = await sizeSvg(page, img.buf.toString('utf8'), n.w, n.h);
			if (svg) return Object.assign({t: 'svg'}, base, {svg});
			warn('SVG not parsed, skipped: ' + short(n.src));
			return null;
		}
		let data = img.buf.toString('base64');
		if (!RASTER_OK.test(img.type)) {
			try {
				data = await toPng(page, 'data:' + img.type + ';base64,' + data, n.w, n.h);
			} catch (e) {
				warn('image format ' + img.type + ' not converted, skipped: ' + short(n.src));
				return null;
			}
		}
		return Object.assign({t: 'img'}, base, {data, fit: n.fit}, n.r ? {r: n.r} : {});
	}

	async function layer(l, frame) {
		const img = await load(l.src);
		let data = img.buf.toString('base64');
		if (!RASTER_OK.test(img.type)) data = await toPng(page, 'data:' + img.type + ';base64,' + data, frame.w, frame.h);
		return {type: 'image', data, fit: l.fit};
	}

	async function walk(node) {
		if (node.layers) {
			const out = [];
			for (const l of node.layers) {
				if (l.type !== 'image') {
					out.push(l);
					continue;
				}
				try {
					out.push(await layer(l, node));
				} catch (e) {
					warn('background image not loaded, skipped: ' + short(l.src) + ' (' + e.message + ')');
				}
			}
			if (out.length) node.layers = out; else delete node.layers;
		}
		if (!node.ch) return;
		const kids = [];
		for (const c of node.ch) {
			if (c.t === 'img' && c.src) {
				const r = await imgNode(c);
				if (r) kids.push(r);
				continue;
			}
			await walk(c);
			kids.push(c);
		}
		node.ch = kids;
	}

	await walk(root);
}

// ---- variants ---------------------------------------------------------------------------------------

// "dimensions" (e.g. Language × Theme) -> every combination as one variant, named "English · Dark", with
// parts {Language: "English", Theme: "Dark"} and the options' localStorage / cookies / query merged.
// Without dimensions: the flat "variants" list (D6), or a single unnamed variant.
// The project-wide "localStorage" is added to every variant (a variant's own value for the same key wins).
function variantsOf(settings) {
	const global = settings.localStorage || {};
	return variantList(settings).map(v => Object.keys(global).length ? Object.assign({}, v, {localStorage: Object.assign({}, global, v.localStorage)}) : v);
}

function variantList(settings) {
	const dims = (settings.dimensions || []).filter(d => d && d.name && d.options && d.options.length);
	if (!dims.length) return settings.variants && settings.variants.length ? settings.variants : [{name: null}];
	let combos = [{names: [], parts: {}, localStorage: {}, cookies: [], query: {}}];
	for (const d of dims) {
		const next = [];
		for (const c of combos) {
			for (const o of d.options) {
				next.push({
					names: c.names.concat(o.name),
					parts: Object.assign({}, c.parts, {[d.name]: o.name}),
					localStorage: Object.assign({}, c.localStorage, o.localStorage),
					cookies: c.cookies.concat(o.cookies || []),
					query: Object.assign({}, c.query, o.query),
				});
			}
		}
		combos = next;
	}
	return combos.map(c => ({name: c.names.join(' · '), parts: c.parts, localStorage: c.localStorage, cookies: c.cookies, query: c.query}));
}

// ---- run --------------------------------------------------------------------------------------------

// settings: a projects/<name>.json object. opts: {screens, orientation, pages: [names], out, onProgress, log}
async function capture(settings, opts = {}) {
	const log = opts.log || (() => {});
	const onProgress = opts.onProgress || (() => {});
	const screens = resolveScreens(opts.screens || settings.screens, opts.orientation || settings.orientation);
	const variants = variantsOf(settings);
	const accounts = {};
	for (const a of settings.accounts || []) accounts[a.name] = a;
	let pages = (settings.pages || []).filter(p => !p.skip);
	if (opts.pages && opts.pages.length) pages = pages.filter(p => opts.pages.includes(p.name));
	if (!pages.length) throw new Error('No pages to capture.');

	const source = settings.source || {};
	let server = null, browser = null;
	const captures = [], failures = [];
	// a page's optional "screens" limits it to some sizes: a preset ("phone" = both orientations) or a screen id ("tablet-portrait")
	const onScreen = (entry, screen) => !entry.screens || entry.screens.includes(screen.id) || entry.screens.includes(screen.preset);
	// a page's optional "variants" limits it the same way: a variant name ("English · Light") or a dimension
	// option ("Light"), e.g. a state that only makes sense in one theme
	const onVariant = (entry, v) => !entry.variants || entry.variants.includes(v.name) || Object.values(v.parts || {}).some(o => entry.variants.includes(o));
	const forPage = (screen, variant) => pages.filter(p => onScreen(p, screen) && onVariant(p, variant));
	const total = screens.reduce((n, s) => n + variants.reduce((m, v) => m + forPage(s, v).length, 0), 0);
	if (!total) throw new Error('No pages for the chosen screens (check the pages\' "screens").');
	let done = 0;
	const now = new Date();

	try {
		let origin;
		if (source.folder) {
			server = await staticServer.start(source.folder);
			origin = server.origin;
			log('Serving ' + source.folder + ' at ' + origin);
		} else if (source.url) {
			origin = new URL(source.url).origin;
		} else {
			throw new Error('Settings need "source": {"folder": …} or {"url": …}.');
		}
		browser = await launchBrowser(log);
		const ready = {misses: 0, off: false}; // "Ready when" across the whole run (see settle)

		for (const screen of screens) {
			for (const variant of variants) {
				const site = {origin, query: variant.query || {}, ready};
				const contexts = new Map(); // account name ('' = guest) -> Promise<context>
				const shared = name => {
					if (!contexts.has(name)) {
						const p = newContext(browser, screen, variant, accounts[name] || null, site);
						p.catch(() => {});
						contexts.set(name, p);
					}
					return contexts.get(name);
				};
				const imageCache = new Map();
				try {
					for (const entry of forPage(screen, variant)) {
						const where = screen.label + (variant.name ? ' / ' + variant.name : '');
						const t0 = Date.now();
						const warnings = [];
						let context = null, page = null, fresh = false;
						try {
							const accountName = entry.account || '';
							if (accountName && !accounts[accountName]) throw new Error('Unknown account "' + accountName + '".');
							fresh = !!entry.fresh;
							context = fresh ? await newContext(browser, screen, variant, accounts[accountName] || null, site) : await shared(accountName);
							page = await context.newPage();
							const result = await capturePage(page, entry, settings, site, w => warnings.push(w));
							await takeShots(result.root, page, w => warnings.push(w));
							await resolveImages(result.root, page, context, fresh ? new Map() : imageCache, w => warnings.push(w));
							result.root.n = entry.name;
							captures.push({
								name: entry.name,
								group: entry.group || entry.account || 'Pages',
								screen: {id: screen.id, label: screen.label, width: screen.width, height: screen.height, orientation: screen.orientation},
								variant: variant.name || null,
								variantParts: variant.parts,
								url: result.url,
								width: result.width,
								height: result.height,
								root: result.root,
							});
							log(where + ' | ' + entry.name + ' | ' + result.width + 'x' + result.height + ' | ' + (Date.now() - t0) + ' ms');
							// a phone browser zooms out when something is wider than the screen; the frame keeps the screen width
							if (result.innerWidth !== screen.width) warnings.push('content is ' + result.innerWidth + 'px wide on a ' + screen.width + 'px screen (horizontal overflow); the frame is ' + screen.width + 'px and cuts it off');
						} catch (e) {
							const message = String(e && e.message || e);
							failures.push({name: entry.name, screen: screen.id, variant: variant.name || null, error: message});
							log(where + ' | ' + entry.name + ' | FAILED: ' + message);
						} finally {
							warnings.forEach(w => log('    warning: ' + w));
							if (page && !page.isClosed()) await page.close().catch(() => {});
							if (fresh && context) await context.close().catch(() => {});
						}
						onProgress({done: ++done, total, page: entry.name, screen: screen.id, variant: variant.name || null});
					}
				} finally {
					for (const p of contexts.values()) await p.then(c => c.close(), () => {}).catch(() => {});
				}
			}
		}
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (server) await server.close();
	}

	const data = {version: 1, project: settings.name || 'Project', capturedAt: now.toISOString(), captures};
	let file = null;
	if (captures.length) {
		file = opts.out ? path.resolve(opts.out) : outFile(data.project, now);
		fs.mkdirSync(path.dirname(file), {recursive: true});
		fs.writeFileSync(file, JSON.stringify(data)); // generated data: compact
	}
	return {file, data, failures};
}

// ---- CLI --------------------------------------------------------------------------------------------

function parseArgs(argv) {
	const args = {_: []};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const [k, v] = a.slice(2).split('=');
			// "--flag" alone (or before another --option) is just switched on
			args[k] = v !== undefined ? v : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
		} else args._.push(a);
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args._[0]) {
		console.log('Usage: node src/capture.js <settings.json | site folder> [options]\n'
			+ '  --screens desktop,phone     screen presets (see src/screens.js)\n'
			+ '  --orientation both          portrait | landscape | both (phones, tablets)\n'
			+ '  --pages "Home,Log In"       only these pages\n'
			+ '  --out file.json             where to write the capture\n'
			+ 'With a folder: every .html file becomes a page.\n'
			+ '  --save projects/x.json      also write the generated settings, to edit later\n'
			+ '  --ready "js expression"     wait until it is true on every page');
		process.exit(2);
	}
	let settings;
	if (fs.existsSync(args._[0]) && fs.statSync(args._[0]).isDirectory()) {
		settings = settingsFromFolder(args._[0]);
		if (args.ready) settings.readyWhen = args.ready;
		if (args.screens) settings.screens = String(args.screens).split(',').map(s => s.trim()).filter(Boolean);
		if (args.orientation) settings.orientation = args.orientation;
		console.log('Found ' + settings.pages.length + ' page(s) in ' + settings.source.folder + (settings.pages.length >= MAX_PAGES ? ' (stopped at ' + MAX_PAGES + ')' : ''));
		if (args.save) {
			const out = path.resolve(args.save);
			fs.mkdirSync(path.dirname(out), {recursive: true});
			fs.writeFileSync(out, JSON.stringify(settings, null, '\t') + '\n');
			console.log('Saved settings to ' + path.relative(process.cwd(), out) + ' (edit it, then: node src/capture.js ' + path.relative(process.cwd(), out) + ')');
		}
	} else {
		settings = loadSettings(args._[0]);
	}
	const list = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null);
	const t0 = Date.now();
	const {file, data, failures} = await capture(settings, {
		screens: list(args.screens),
		orientation: args.orientation,
		pages: list(args.pages),
		out: args.out,
		log: m => console.log(m),
	});
	console.log('');
	console.log(data.captures.length + ' capture(s), ' + failures.length + ' failure(s) in ' + Math.round((Date.now() - t0) / 1000) + ' s.');
	if (file) console.log('Wrote ' + path.relative(process.cwd(), file) + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
	for (const f of failures) console.log('  FAILED ' + f.screen + (f.variant ? ' / ' + f.variant : '') + ' | ' + f.name + ': ' + f.error);
	process.exit(failures.length ? 1 : 0);
}

if (require.main === module) {
	main().catch(e => {
		console.error(e && e.stack || e);
		process.exit(1);
	});
}

module.exports = {capture, loadSettings, settingsFromFolder, variantsOf, launchBrowser, newContext, settle, listHtml, titleName, fileName};
