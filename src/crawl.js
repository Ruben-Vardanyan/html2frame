// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// crawl.js — finds a site's pages by following its links in a real browser (D2, D5).
// Breadth-first from `start`, same origin only, reading links from the rendered DOM (so links added by
// JavaScript count). Runs once as a guest, then once per test account after its login: pages first seen
// while logged in belong to that account. Detail pages that only differ by id (?slug=…, /items/12) are
// kept once, with the rest listed as "similar" (one example per template).
// Also a CLI: node src/crawl.js projects/x.json [--save projects/x.json] [--depth 3] [--max 200]

const fs = require('fs');
const path = require('path');
const {resolveScreens} = require('./screens');
const staticServer = require('./static-server');
const {loadSettings, settingsFromFolder, variantsOf, launchBrowser, newContext, settle, listHtml, titleName, fileName} = require('./capture');

const SKIP_EXT = /\.(pdf|zip|rar|7z|gz|tar|png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|css|js|mjs|map|json|xml|txt|csv|xlsx?|docx?|pptx?|exe|dmg|apk)$/i;
const LOGOUT = /log\s*-?\s*out|sign\s*-?\s*out|log\s*off/i; // never follow these: they end the session
const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|_ga$)/;

// Absolute link -> "/path?sorted=query" on this origin, or null when it is not a page to visit.
// ignore: query keys that only select a variant (e.g. lang), so they do not make pages different.
function normalise(href, origin, ignore) {
	let u;
	try {
		u = new URL(href, origin + '/');
	} catch (e) {
		return null;
	}
	if (!/^https?:$/.test(u.protocol) || u.origin !== origin || SKIP_EXT.test(u.pathname)) return null;
	const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k) && !ignore.has(k)).sort((a, b) => (a[0] + '=' + a[1]).localeCompare(b[0] + '=' + b[1]));
	const qs = new URLSearchParams(params).toString();
	return u.pathname + (qs ? '?' + qs : '');
}

// The page template an address belongs to: the path without its query, with id-like segments as "*".
// "/policy.html?slug=auto-basic" and "/policy-browse.html?type=1&page=2" -> their path; "/items/12" -> "/items/*".
// Addresses of one template are one entry: filters, paging and detail ids are "similar".
function templateOf(p) {
	const u = new URL(p, 'http://x');
	return u.pathname.split('/').map(s => (/^\d+$/.test(s) || /^[0-9a-f-]{16,}$/i.test(s) ? '*' : s)).join('/');
}

const PER_TEMPLATE = 3; // addresses opened per template (more rarely lead anywhere new, and cost time)

// What one page offers: final address, title, first h1, and its links.
async function readPage(page) {
	return page.evaluate(() => ({
		url: location.href,
		title: document.title || '',
		h1: (document.querySelector('h1') && document.querySelector('h1').textContent || '').replace(/\s+/g, ' ').trim(),
		links: [...document.querySelectorAll('a[href], area[href]')].map(a => ({
			href: a.href,
			text: (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
			download: a.hasAttribute('download'),
			raw: a.getAttribute('href') || '',
		})),
	}));
}

// Breadth-first crawl in one browser context. Returns pages in visiting order:
// [{path, title, h1, depth}]; addresses that redirected elsewhere are returned in `redirects`.
async function crawlContext(context, site, settings, seeds, opts, log) {
	const ignore = new Set(Object.keys(site.query || {}));
	const queue = [], seen = new Set(), pages = [], redirects = [], perTemplate = {}, skipped = [];
	const enqueue = (k, depth) => {
		if (!k || seen.has(k)) return;
		seen.add(k);
		const t = templateOf(k);
		if ((perTemplate[t] = (perTemplate[t] || 0) + 1) > PER_TEMPLATE) {
			skipped.push(k); // listed as similar, not opened
			return;
		}
		queue.push({path: k, depth});
	};
	for (const s of seeds) enqueue(normalise(s, site.origin, ignore), 0);
	const page = await context.newPage();
	const ready = {misses: 0, off: false}, warned = new Set(); // "Ready when" that never comes true: see settle()
	try {
		while (queue.length && pages.length < opts.max) {
			const item = queue.shift();
			let info;
			try {
				const url = new URL(item.path, site.origin + '/');
				for (const [k, v] of Object.entries(site.query || {})) url.searchParams.set(k, v);
				await page.goto(url.href, {waitUntil: 'load'});
				await settle(page, Object.assign({}, settings, {settleMs: Math.min(settings.settleMs ?? 300, 300)}), ready, w => { if (!warned.has(w)) { warned.add(w); log('  ' + w); } });
				info = await readPage(page);
			} catch (e) {
				log('  could not open ' + item.path + ': ' + String(e.message).split('\n')[0]);
				continue;
			}
			const final = normalise(info.url, site.origin, ignore) || item.path;
			if (final !== item.path) {
				redirects.push({from: item.path, to: final});
				if (seen.has(final)) continue; // e.g. a members-only page that sent us to the login page
				seen.add(final);
			}
			pages.push({path: final, title: info.title, h1: info.h1, depth: item.depth});
			if (item.depth >= opts.depth) continue;
			for (const l of info.links) {
				if (l.download || /^(mailto|tel|javascript|sms|data):/i.test(l.raw) || l.raw.startsWith('#')) continue;
				if (LOGOUT.test(l.text) || LOGOUT.test(l.raw)) continue;
				enqueue(normalise(l.href, site.origin, ignore), item.depth + 1);
			}
		}
	} finally {
		await page.close().catch(() => {});
	}
	return {pages, redirects, skipped, more: queue.length};
}

// "Policies — InsureNow" -> "Policies"
function shortTitle(t) {
	return String(t || '').split(/\s+[—–|]\s+|\s+-\s+/)[0].trim();
}

// Page names: the short title when it is unique; else from the file name ("Home", "Profile"). The h1 is used
// only for detail pages (an address with a query), where it names the item; elsewhere it is often a slogan
// or a person's name.
function nameAll(list) {
	const count = key => list.reduce((m, p) => (m[p[key]] = (m[p[key]] || 0) + 1, m), {});
	list.forEach(p => { p.short = shortTitle(p.title); });
	const shorts = count('short'), h1s = count('h1');
	const used = {};
	for (const p of list) {
		const u = new URL(p.path, 'http://x');
		const fromPath = fileName(u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname) + (u.search ? ' (' + [...u.searchParams.values()].join(', ') + ')' : '');
		let name = p.short && shorts[p.short] === 1 ? p.short : u.search && p.h1 && h1s[p.h1] === 1 && p.h1.length <= 60 ? p.h1 : fromPath;
		if (used[name]) name = fromPath;
		if (used[name]) name += ' ' + p.path;
		used[name] = true;
		p.name = name;
	}
}

// settings -> {pages: [{name, path, group, account?, similar?}], unlinked: [...], redirects, log}
async function crawl(settings, opts = {}) {
	const log = opts.log || (() => {});
	const o = {depth: opts.depth ?? 3, max: opts.max ?? 200};
	const screen = resolveScreens(settings.screens && settings.screens.length ? [settings.screens[0]] : ['desktop'], 'portrait')[0];
	const variant = variantsOf(settings)[0];
	const accounts = settings.accounts || [];
	const source = settings.source || {};
	let server = null, browser = null;
	let redirects = [], truncated = false;

	// one entry per template, first seen wins (a guest before any account); the plain address (no query) is
	// preferred as the example, every other address of the template is "similar"
	const kept = [], byTemplate = {}, reached = new Set();
	const place = (p, opened) => {
		reached.add(p.path);
		const t = templateOf(p.path);
		const k = byTemplate[t];
		if (!k) {
			if (!opened) return false;
			kept.push(byTemplate[t] = Object.assign({similar: []}, p));
			return true;
		}
		if (k.path === p.path || k.similar.includes(p.path)) return false;
		if (opened && k.path.includes('?') && !p.path.includes('?')) {
			k.similar.unshift(k.path);
			Object.assign(k, {path: p.path, title: p.title, h1: p.h1});
		} else {
			k.similar.push(p.path);
		}
		return false;
	};

	try {
		let origin;
		if (source.folder) {
			server = await staticServer.start(source.folder);
			origin = server.origin;
		} else if (source.url) {
			origin = new URL(source.url).origin;
		} else {
			throw new Error('Settings need "source": {"folder": …} or {"url": …}.');
		}
		const site = {origin, query: variant.query || {}};
		const start = settings.start || (source.url ? new URL(source.url).pathname : '/index.html');
		browser = await launchBrowser(log);

		const runs = [{name: null, account: null}].concat(accounts.map(a => ({name: a.name, account: a})));
		for (const run of runs) {
			log(run.name ? 'Crawling as "' + run.name + '"…' : 'Crawling as a guest…');
			const info = {};
			let context;
			try {
				context = await newContext(browser, screen, variant, run.account, site, info);
			} catch (e) {
				log('  ' + e.message.split('\n')[0] + ' (skipped)');
				continue;
			}
			try {
				const seeds = [start].concat(info.landing ? [info.landing] : []);
				const r = await crawlContext(context, site, settings, seeds, o, log);
				redirects = redirects.concat(r.redirects.map(x => Object.assign({account: run.name}, x)));
				if (r.more) truncated = true;
				let added = 0;
				for (const p of r.pages) if (place(Object.assign({account: run.name}, p), true)) added++;
				for (const k of r.skipped) place({path: k, account: run.name}, false);
				log('  ' + r.pages.length + ' address(es) opened, ' + added + ' new page(s)' + (r.more ? ' (stopped at ' + o.max + ')' : ''));
			} finally {
				await context.close().catch(() => {});
			}
		}
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (server) await server.close();
	}

	nameAll(kept);
	const guestGroup = accounts.length ? 'Public' : 'Pages';
	const pages = kept.map(p => {
		const e = {name: p.name, path: p.path, group: p.account || guestGroup};
		if (p.account) e.account = p.account;
		if (p.similar.length) e.similar = p.similar;
		return e;
	});

	// for a folder: .html files that no link leads to (often drafts or pages opened by script)
	let unlinked = [];
	if (source.folder) {
		const root = path.resolve(source.folder);
		const paths = new Set([...reached].concat(redirects.map(r => r.from)).map(p => new URL(p, 'http://x').pathname));
		const files = listHtml(root)
			.map(f => ({file: f, path: '/' + path.relative(root, f).split(path.sep).join('/'), title: titleName(f)}))
			.filter(f => !paths.has(f.path) && !(f.path.endsWith('/index.html') && paths.has(f.path.slice(0, -'index.html'.length))));
		// a title shared with other files or found pages is usually the site name: use the file name then
		const titles = files.map(f => f.title).concat(kept.map(p => p.short));
		const taken = new Set(pages.map(p => p.name));
		unlinked = files.map(f => {
			let name = f.title && titles.filter(t => t === f.title).length === 1 && !taken.has(f.title) ? f.title : fileName(f.file);
			if (taken.has(name)) name += ' (' + f.path.slice(1) + ')';
			taken.add(name);
			return {name, path: f.path, group: 'Not linked'};
		});
	}
	return {pages, unlinked, redirects, truncated};
}

// Merge crawled pages into existing settings: pages already there (by path) and pages with steps keep the
// user's edits; new ones are appended.
function mergePages(existing, crawled) {
	const have = new Set((existing || []).filter(p => p.path).map(p => p.path));
	const added = crawled.filter(p => !have.has(p.path));
	return {pages: (existing || []).concat(added), added: added.length};
}

// ---- CLI --------------------------------------------------------------------------------------------

async function main() {
	const argv = process.argv.slice(2);
	const args = {_: []};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--')) {
			const [k, v] = argv[i].slice(2).split('=');
			// "--flag" alone (or before another --option) is just switched on
			args[k] = v !== undefined ? v : argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
		} else args._.push(argv[i]);
	}
	if (!args._[0]) {
		console.log('Usage: node src/crawl.js <settings.json | site folder> [options]\n'
			+ '  --depth 3                  how many clicks away from the start page\n'
			+ '  --max 200                  stop after this many pages (per guest / account)\n'
			+ '  --save projects/x.json     write settings with the found pages added (existing pages are kept)\n'
			+ '  --unlinked                 also add .html files no link leads to (group "Not linked")');
		process.exit(2);
	}
	const isFolder = fs.existsSync(args._[0]) && fs.statSync(args._[0]).isDirectory();
	const settings = isFolder ? Object.assign(settingsFromFolder(args._[0]), {pages: []}) : loadSettings(args._[0]);
	const t0 = Date.now();
	const r = await crawl(settings, {depth: args.depth ? Number(args.depth) : undefined, max: args.max ? Number(args.max) : undefined, log: m => console.log(m)});

	console.log('');
	const w = Math.max(...r.pages.concat(r.unlinked).map(p => p.name.length), 4);
	let group = null;
	for (const p of r.pages) {
		if (p.group !== group) console.log('\n' + (group = p.group));
		console.log('  ' + p.name.padEnd(w) + '  ' + p.path + (p.similar ? '  (+' + p.similar.length + ' similar)' : ''));
	}
	if (r.unlinked.length) {
		console.log('\nNot linked from anywhere (' + (args.unlinked !== undefined ? 'added' : 'add with --unlinked') + ')');
		r.unlinked.forEach(p => console.log('  ' + p.name.padEnd(w) + '  ' + p.path));
	}
	const sim = r.pages.reduce((n, p) => n + (p.similar ? p.similar.length : 0), 0);
	console.log('\n' + r.pages.length + ' page(s)' + (sim ? ', ' + sim + ' similar left out' : '') + (r.truncated ? ', stopped at the page limit' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s.');

	if (args.save) {
		const out = path.resolve(args.save);
		const base = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : settings; // as written (relative folder kept)
		const found = r.pages.concat(args.unlinked !== undefined ? r.unlinked : []);
		const m = mergePages(base.pages, found);
		fs.mkdirSync(path.dirname(out), {recursive: true});
		fs.writeFileSync(out, JSON.stringify(Object.assign({}, base, {pages: m.pages}), null, '\t') + '\n');
		console.log('Saved ' + path.relative(process.cwd(), out) + ': ' + m.added + ' page(s) added, ' + (m.pages.length - m.added) + ' kept.');
	}
}

if (require.main === module) {
	main().catch(e => {
		console.error(e && e.stack || e);
		process.exit(1);
	});
}

module.exports = {crawl, mergePages, normalise, templateOf};
