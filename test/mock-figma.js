// mock-figma.js — runs figma-plugin/code.js against a fake Figma API.
// node test/mock-figma.js [capture.json]   (default: the newest captures/*.json, plus test/prototype-sample.json)
// Checks: both file formats import with no errors, the right Figma pages are created (D4), frames are named
// per D6, rows go below existing content, paints are valid, the page limit falls back, and fonts are reported.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const CODE = path.join(ROOT, 'figma-plugin', 'code.js');
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ---- fake Figma -------------------------------------------------------------------------------------

function finite(v, what) {
	if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(what + ' is not a finite number: ' + v);
}

function checkPaint(p) {
	if (p.type === 'SOLID') {
		['r', 'g', 'b'].forEach(k => finite(p.color[k], 'SOLID color.' + k));
		return;
	}
	if (p.type === 'GRADIENT_LINEAR') {
		if (!Array.isArray(p.gradientTransform) || p.gradientTransform.length !== 2) throw new Error('gradientTransform must be 2×3');
		p.gradientTransform.forEach(r => {
			if (r.length !== 3) throw new Error('gradientTransform must be 2×3');
			r.forEach(v => finite(v, 'gradientTransform'));
		});
		if (p.gradientStops.length < 2) throw new Error('gradient needs 2 stops');
		p.gradientStops.forEach(s => {
			if (!(s.position >= 0 && s.position <= 1)) throw new Error('stop position out of range: ' + s.position);
			['r', 'g', 'b', 'a'].forEach(k => finite(s.color[k], 'stop color.' + k));
		});
		return;
	}
	if (p.type === 'IMAGE') {
		if (!p.imageHash) throw new Error('IMAGE paint without imageHash');
		if (!/^(FILL|FIT|CROP|TILE)$/.test(p.scaleMode)) throw new Error('bad scaleMode ' + p.scaleMode);
		return;
	}
	throw new Error('unknown paint type ' + p.type);
}

function makeFigma(opts = {}) {
	const counts = {};
	const messages = [];
	const loadedFonts = [];
	const storage = Object.assign({}, opts.storage);
	let handler = null;

	function node(type) {
		counts[type] = (counts[type] || 0) + 1;
		let fills = [];
		const n = {
			type, children: [], parent: null, width: 100, height: 100, x: 0, y: 0, name: '',
			appendChild(c) {
				if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
				c.parent = this;
				this.children.push(c);
			},
			resize(w, h) {
				if (!(w >= 0.01 && h >= 0.01)) throw new Error(type + ' bad size ' + w + 'x' + h);
				this.width = w;
				this.height = h;
			},
			rescale(s) {
				if (!(s > 0)) throw new Error('bad rescale ' + s);
				this.width *= s;
				this.height *= s;
				this.rescaled = s;
			},
		};
		let rel = null;
		Object.defineProperty(n, 'relativeTransform', {get: () => rel, set(m) {
			if (!Array.isArray(m) || m.length !== 2 || m.some(r => r.length !== 3 || r.some(v => !Number.isFinite(v)))) throw new Error('relativeTransform must be 2×3 numbers');
			// Figma keeps size out of the matrix: rotation (+ translation) only
			if (Math.abs(m[0][0] * m[0][0] + m[1][0] * m[1][0] - 1) > 1e-6 || Math.abs(m[0][0] - m[1][1]) > 1e-6 || Math.abs(m[0][1] + m[1][0]) > 1e-6) throw new Error('relativeTransform is not a rotation');
			rel = m;
		}});
		Object.defineProperty(n, 'fills', {get: () => fills, set(v) {
			if (!Array.isArray(v)) throw new Error('fills must be an array');
			v.forEach(checkPaint);
			fills = v;
		}});
		if (type === 'TEXT') {
			let font = null, chars = '';
			Object.defineProperty(n, 'fontName', {set(v) {
				if (!loadedFonts.some(f => f.family === v.family && f.style === v.style)) throw new Error('font not loaded: ' + v.family + ' ' + v.style);
				font = v;
			}, get: () => font});
			Object.defineProperty(n, 'characters', {set(v) {
				if (!font) throw new Error('set fontName before characters');
				chars = v;
				this.width = v.length * 7;
				this.ranges = [];
			}, get: () => chars});
			n.setRangeFontName = (start, end, f) => {
				if (!(start >= 0 && end > start && end <= chars.length)) throw new Error('bad range ' + start + '-' + end + ' for ' + chars.length + ' chars');
				if (!loadedFonts.some(x => x.family === f.family && x.style === f.style)) throw new Error('range font not loaded: ' + f.family + ' ' + f.style);
				n.ranges.push({start, end, font: f, text: chars.slice(start, end)});
			};
		}
		return n;
	}

	function page(name) {
		const p = node('PAGE');
		p.name = name;
		return p;
	}

	const root = {children: [page('Page 1')]};
	let current = root.children[0];
	const figma = {
		root,
		get currentPage() { return current; },
		set currentPage(v) { throw new Error('use setCurrentPageAsync with dynamic-page'); },
		async setCurrentPageAsync(p) {
			if (!root.children.includes(p)) throw new Error('not a page of this file');
			current = p;
		},
		createPage() {
			if (opts.maxPages && root.children.length >= opts.maxPages) throw new Error('page limit reached');
			const p = page('Page ' + (root.children.length + 1));
			root.children.push(p);
			return p;
		},
		showUI() {},
		ui: {
			set onmessage(f) { handler = f; },
			postMessage(m) { messages.push(m); },
		},
		async loadFontAsync(f) {
			if ((opts.missingFonts || []).includes(f.family)) throw new Error('missing font');
			if (opts.available && !opts.available.some(([family, styles]) => family === f.family && styles.includes(f.style))) throw new Error('not installed: ' + f.family + ' ' + f.style);
			loadedFonts.push(f);
		},
		// opts.available: [[family, [styles]]]; without it the list is empty ("unknown", the plugin just tries loading)
		async listAvailableFontsAsync() {
			return (opts.available || []).flatMap(([family, styles]) => styles.map(style => ({fontName: {family, style}})));
		},
		createFrame: () => node('FRAME'),
		createText: () => node('TEXT'),
		createRectangle: () => node('RECT'),
		createSection: opts.noSections ? undefined : () => {
			const n = node('SECTION');
			n.resize = () => { throw new Error('sections use resizeWithoutConstraints'); };
			n.resizeWithoutConstraints = (w, h) => {
				if (!(w > 0 && h > 0)) throw new Error('SECTION bad size ' + w + 'x' + h);
				n.width = w;
				n.height = h;
			};
			return n;
		},
		createNodeFromSvg(s) {
			if (!s.startsWith('<svg')) throw new Error('bad svg');
			return node('SVG');
		},
		// flatten(nodes, parent, index): the nodes become one vector at index in parent
		flatten(nodes, parent, index) {
			for (const x of nodes) if (x.parent) x.parent.children.splice(x.parent.children.indexOf(x), 1);
			const v = node('VECTOR');
			v.parent = parent;
			parent.children.splice(index === undefined ? parent.children.length : index, 0, v);
			return v;
		},
		createImage(bytes) {
			const b = Buffer.from(bytes);
			const ok = (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x47 && b[1] === 0x49);
			if (!ok) throw new Error('Image type is unsupported');
			counts.IMAGE = (counts.IMAGE || 0) + 1;
			return {hash: 'h' + counts.IMAGE};
		},
		base64Decode: s => new Uint8Array(Buffer.from(s, 'base64')),
		viewport: {center: {x: 0, y: 0}, scrollAndZoomIntoView() {}},
		clientStorage: {
			async getAsync(k) { return storage[k]; },
			async setAsync(k, v) { storage[k] = v; },
		},
	};

	global.figma = figma;
	global.__html__ = '';
	delete require.cache[require.resolve(CODE)];
	require(CODE);

	async function send(msg) {
		const before = messages.length;
		await handler(msg);
		return messages.slice(before);
	}
	return {figma, counts, messages, send, storage};
}

// ---- helpers ----------------------------------------------------------------------------------------

async function load(env, files) {
	const out = await env.send({type: 'load', files});
	const m = out.find(x => x.type === 'loaded' || x.type === 'error');
	if (!m || m.type !== 'loaded') throw new Error('load failed: ' + (m && m.text));
	return m;
}

// sel: {screens, variants?, groups?}; default = everything in the file
async function importAll(env, loaded, sel, layout = 'pages') {
	const all = {screens: loaded.screens.map(o => o.id), variants: loaded.variants.map(o => o.id), groups: loaded.groups.map(o => o.id)};
	const out = await env.send(Object.assign({type: 'import', layout}, sel || all));
	const done = out.find(x => x.type === 'done');
	assert(done, 'no done message');
	assert(!/^Error/.test(done.text), done.text);
	return done.text;
}

function framesOf(page) {
	return page.children.filter(c => c.type === 'FRAME');
}

function pageNames(env) {
	return env.figma.root.children.map(p => p.name);
}

function bottom(page) {
	return Math.max(...page.children.map(c => c.y + c.height));
}

let failed = 0;
async function test(name, fn) {
	try {
		const note = await fn();
		console.log('ok    ' + name + (note ? '  ' + note : ''));
	} catch (e) {
		failed++;
		console.log('FAIL  ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n      '));
	}
}

function newestCapture() {
	const dir = path.join(ROOT, 'captures');
	if (!fs.existsSync(dir)) return null;
	const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
	files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	return files[0] || null;
}

// small v1 file: 2 screens × 2 variants, gradient + image layers, an image node, an svg, a missing font
function synthetic() {
	const caps = [];
	const screens = [
		{id: 'desktop', label: 'Desktop', width: 1440, height: 900, orientation: 'landscape'},
		{id: 'phone-portrait', label: 'Phone portrait', width: 390, height: 844, orientation: 'portrait'},
	];
	for (const screen of screens) {
		for (const variant of ['English', 'Armenian']) {
			for (const [name, group] of [['Home', 'Public'], ['Dashboard', 'Customer']]) {
				const w = screen.width;
				caps.push({
					name, group, screen, variant, url: '/index.html', width: w, height: 1200,
					root: {t: 'f', n: name, x: 0, y: 0, w, h: 1200, bg: [1, 1, 1, 1], br: {tl: 0, tr: 0, br: 0, bl: 0}, bd: null, sh: [], op: 1, clip: true, ch: [
						{t: 'f', n: 'section.hero', x: 0, y: 0, w, h: 400, bg: null, br: {tl: 0, tr: 0, br: 0, bl: 0}, bd: null, sh: [], op: 1, clip: false,
							layers: [
								{type: 'image', data: PNG_1PX, fit: 'cover'},
								{type: 'gradient', angle: 135, stops: [{c: [0, 0, 0, 0.6], p: 0}, {c: [0, 0, 0, 0], p: 1}]},
							],
							ch: [
								{t: 't', s: 'Welcome ' + variant, x: 40, y: 40, w: 300, h: 48, ff: 'Fancy Display', fw: 700, fs: 40, it: false, lh: 48, ls: 0, c: [1, 1, 1, 1], tc: 'none', td: 'none', al: 'left', multi: false},
								{t: 'img', n: 'logo', x: 40, y: 120, w: 64, h: 64, data: PNG_1PX, fit: 'contain', r: {tl: 8, tr: 8, br: 8, bl: 8}},
								{t: 'svg', n: 'icon', x: 120, y: 120, w: 24, h: 24, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M0 0h24v24H0z" fill="#000"/></svg>'},
								{t: 'img', n: 'broken', x: 160, y: 120, w: 24, h: 24, data: Buffer.from('not an image').toString('base64'), fit: 'fill'},
							]},
					]},
				});
			}
		}
	}
	return {version: 1, project: 'Synthetic', capturedAt: new Date().toISOString(), captures: caps};
}

// ---- tests ------------------------------------------------------------------------------------------

(async () => {
	const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'prototype-sample.json'), 'utf8'));
	const v1File = process.argv[2] || newestCapture();

	await test('prototype file → one "Desktop" page, 3 frames in 3 rows', async () => {
		const env = makeFigma();
		const loaded = await load(env, [sample]);
		assert.strictEqual(loaded.total, 3);
		assert.deepStrictEqual(loaded.screens.map(o => o.id + '/' + o.label + '/' + o.count), ['desktop/Desktop/3']);
		assert.deepStrictEqual(loaded.groups.map(o => o.id + '/' + o.count), ['Public/1', 'Customer/1', 'Admin/1']);
		assert.deepStrictEqual(loaded.variants.map(o => o.id + '/' + o.label), ['/Default']);
		const text = await importAll(env, loaded);
		assert.deepStrictEqual(pageNames(env), ['Desktop'], 'the empty default page is reused');
		const page = env.figma.root.children[0];
		const frames = framesOf(page);
		assert.strictEqual(frames.length, 3);
		assert.strictEqual(frames[0].name, 'Home');
		assert.deepStrictEqual(page.children.filter(c => c.type === 'TEXT').map(t => t.characters), ['Public', 'Customer', 'Admin']);
		const c = env.counts;
		assert.strictEqual(c.FRAME, 114, 'one Figma frame per frame node');
		assert.strictEqual(c.SVG, 5, 'svgs');
		assert.strictEqual(c.TEXT, 61 + 3, 'text layers, plus the 3 row labels');
		assert(/Done: 3 page\(s\) imported/.test(text), text);
		return JSON.stringify({FRAME: c.FRAME, TEXT: c.TEXT, SVG: c.SVG});
	});

	if (v1File) {
		await test('v1 capture ' + path.relative(ROOT, v1File) + ' → pages per screen, frames named "Page — Variant"', async () => {
			const data = JSON.parse(fs.readFileSync(v1File, 'utf8'));
			const env = makeFigma();
			const loaded = await load(env, [data]);
			const text = await importAll(env, loaded);
			const multi = new Set(data.captures.map(c => c.variant || '')).size > 1;
			const expected = [...new Set(data.captures.map(c => c.screen.label + (multi && c.variant ? ' — ' + c.variant : '')))];
			assert.deepStrictEqual(pageNames(env), expected);
			const frames = env.figma.root.children.flatMap(framesOf);
			assert.strictEqual(frames.length, data.captures.length);
			const c0 = data.captures[0];
			assert.strictEqual(frames[0].name, c0.variant ? c0.name + ' — ' + c0.variant : c0.name);
			assert(!/Failed:/.test(text), text);
			return frames.length + ' frames, ' + JSON.stringify(env.counts);
		});
	} else {
		console.log('skip  v1 capture (no captures/*.json; run src/capture.js first)');
	}

	await test('synthetic v1: screens × variants → 4 pages, gradients and images, font report', async () => {
		const env = makeFigma({missingFonts: ['Fancy Display']});
		const loaded = await load(env, [synthetic()]);
		const text = await importAll(env, loaded);
		assert.deepStrictEqual(pageNames(env), ['Desktop — English', 'Desktop — Armenian', 'Phone portrait — English', 'Phone portrait — Armenian']);
		for (const p of env.figma.root.children) {
			assert.deepStrictEqual(framesOf(p).map(f => f.name).sort(), ['Dashboard — ' + p.name.split(' — ')[1], 'Home — ' + p.name.split(' — ')[1]].sort());
		}
		const hero = framesOf(env.figma.root.children[0])[0].children[0];
		assert.deepStrictEqual(hero.fills.map(f => f.type), ['IMAGE', 'GRADIENT_LINEAR']);
		const logo = hero.children.find(n => n.name === 'logo');
		assert.strictEqual(logo.fills[0].type, 'IMAGE');
		assert.strictEqual(logo.fills[0].scaleMode, 'FIT');
		assert.strictEqual(logo.topLeftRadius, 8);
		assert(hero.children.some(n => n.name === 'broken (not imported)'), 'an unsupported image becomes a placeholder');
		assert(/Fancy Display → Inter\n/.test(text), 'missing font reported:\n' + text);
		assert(/image not imported: broken/.test(text), 'broken image reported');
		assert.strictEqual(env.counts.IMAGE, 1, 'the same image data is uploaded once');
	});

	await test('gradient transform: 90° is identity, 180° maps top → bottom', async () => {
		const env = makeFigma();
		const data = synthetic();
		data.captures = data.captures.slice(0, 1);
		const hero = data.captures[0].root.ch[0];
		hero.layers = [{type: 'gradient', angle: 90, stops: [{c: [1, 0, 0, 1], p: 0}, {c: [0, 0, 1, 1], p: 1}]}, {type: 'gradient', angle: 180, stops: [{c: [1, 0, 0, 1], p: 0}, {c: [0, 0, 1, 1], p: 1}]}];
		await importAll(env, await load(env, [data]));
		const [g90, g180] = framesOf(env.figma.root.children[0])[0].children[0].fills;
		const round = m => m.map(r => r.map(v => Math.round(v * 1e6) / 1e6 + 0));
		assert.deepStrictEqual(round(g90.gradientTransform), [[1, 0, 0], [0, 1, 0]]);
		assert.deepStrictEqual(round(g180.gradientTransform), [[0, 1, 0], [-1, 0, 1]]);
	});

	await test('page limit (free plan) → falls back to a Section on an existing page and says so', async () => {
		const env = makeFigma({maxPages: 3});
		const text = await importAll(env, await load(env, [synthetic()]));
		assert.deepStrictEqual(pageNames(env), ['Desktop — English', 'Desktop — Armenian', 'Phone portrait — English']);
		const first = env.figma.root.children[0];
		assert.strictEqual(framesOf(first).length, 2, 'its own frames stay loose on its page');
		const extra = first.children.find(c => c.type === 'SECTION');
		assert(extra && extra.name === 'Phone portrait — Armenian', 'the 4th screen is a Section on the first page');
		assert.strictEqual(framesOf(extra).length, 2);
		assert(/Could not add a Figma page for "Phone portrait — Armenian"/.test(text), text);
	});

	await test('second import → same pages, new rows start below the existing content', async () => {
		const env = makeFigma();
		const loaded = await load(env, [sample]);
		await importAll(env, loaded);
		const page = env.figma.root.children[0];
		const firstBottom = bottom(page);
		const firstCount = page.children.length;
		await importAll(env, loaded, {screens: ['desktop'], groups: ['Public']});
		assert.deepStrictEqual(pageNames(env), ['Desktop']);
		const added = page.children.slice(firstCount);
		assert.strictEqual(framesOf({children: added}).length, 1, 'only the selected group');
		assert(Math.min(...added.map(c => c.y)) >= firstBottom + 400, 'below existing content with a 400 px gap');
	});

	await test('layout "single" (default) → one Figma Section per screen/variant on the current page', async () => {
		const env = makeFigma();
		await new Promise(r => setImmediate(r));
		assert.deepStrictEqual(env.messages.find(m => m.type === 'settings'), {type: 'settings', layout: 'single', autoLayout: false}, 'default layout sent to the UI');
		const loaded = await load(env, [synthetic()]);
		const text = await importAll(env, loaded, null, null); // no layout in the message -> default
		assert.deepStrictEqual(pageNames(env), ['Page 1'], 'no pages created');
		const page = env.figma.root.children[0];
		const sections = page.children.filter(c => c.type === 'SECTION');
		assert.deepStrictEqual(sections.map(s => s.name), ['Desktop — English', 'Desktop — Armenian', 'Phone portrait — English', 'Phone portrait — Armenian']);
		assert.strictEqual(page.children.length, 4, 'only sections on the page');
		for (const s of sections) {
			const v = s.name.split(' — ')[1];
			assert.deepStrictEqual(framesOf(s).map(f => f.name), ['Home — ' + v, 'Dashboard — ' + v]);
			assert.deepStrictEqual(s.children.filter(c => c.type === 'TEXT').map(t => t.characters), ['Public', 'Customer'], 'group labels inside');
			for (const c of s.children) assert(c.x >= 0 && c.y >= 0 && c.x + c.width <= s.width && c.y + c.height <= s.height, s.name + ': ' + (c.name || c.characters) + ' sticks out of its section');
		}
		assert(sections.every((s, i) => i === 0 || s.y >= sections[i - 1].y + sections[i - 1].height + 400), 'sections stacked with a 400 px gap');
		assert(/onto "Page 1"/.test(text), text);
		assert.strictEqual(env.storage.layout, 'single', 'choice remembered');
		const again = await importAll(env, loaded, {screens: ['desktop'], variants: ['English'], groups: ['Public']}, 'single');
		const added = page.children.slice(4);
		assert.strictEqual(added.length, 1);
		assert(added[0].y >= sections[3].y + sections[3].height + 400, 'a second import goes below');
	});

	await test('layout "single" without Sections (older Figma) → big titles instead', async () => {
		const env = makeFigma({noSections: true});
		await importAll(env, await load(env, [synthetic()]), null, 'single');
		const page = env.figma.root.children[0];
		assert.strictEqual(framesOf(page).length, 8);
		const titles = page.children.filter(c => c.type === 'TEXT' && c.fontSize === 96).map(t => t.characters);
		assert.deepStrictEqual(titles, ['Desktop — English', 'Desktop — Armenian', 'Phone portrait — English', 'Phone portrait — Armenian']);
	});

	await test('remembered layout "pages" is sent to the UI on start', async () => {
		const env = makeFigma({storage: {layout: 'pages'}});
		await new Promise(r => setImmediate(r));
		assert.deepStrictEqual(env.messages.find(m => m.type === 'settings'), {type: 'settings', layout: 'pages', autoLayout: false});
	});

	await test('choices: screens, variants and groups with exact counts; selection filters the import', async () => {
		const env = makeFigma();
		const loaded = await load(env, [synthetic()]);
		assert.deepStrictEqual(loaded.screens.map(o => o.id + ' ' + o.width + 'x' + o.height + ' ' + o.count), ['desktop 1440x900 4', 'phone-portrait 390x844 4']);
		assert.deepStrictEqual(loaded.variants.map(o => o.id), ['English', 'Armenian']);
		assert.deepStrictEqual(loaded.groups.map(o => o.id), ['Public', 'Customer']);
		assert.strictEqual(loaded.combos['phone-portrait\nArmenian\nCustomer'], 1);
		const out = await env.send({type: 'import', screens: [], layout: 'single'});
		assert.deepStrictEqual(out.map(m => m.type + ': ' + m.text), ['error: Choose at least one screen size.'], 'no screen chosen -> refused');
		const text = await importAll(env, loaded, {screens: ['phone-portrait'], variants: ['Armenian']}, 'single');
		const page = env.figma.root.children[0];
		assert.deepStrictEqual(page.children.map(c => c.name), ['Phone portrait — Armenian']);
		assert.strictEqual(framesOf(page.children[0]).length, 2, 'both groups (groups not given = all)');
		assert(/Done: 2 page/.test(text), text);
	});

	await test('variants from dimensions (Language × Theme) → one choice list per dimension', async () => {
		const env = makeFigma();
		const data = synthetic();
		const parts = {English: {Language: 'English', Theme: 'Light'}, Armenian: {Language: 'Armenian', Theme: 'Dark'}};
		data.captures.forEach(c => {
			c.variantParts = parts[c.variant];
			c.variant = c.variantParts.Language + ' · ' + c.variantParts.Theme;
		});
		const loaded = await load(env, [data]);
		assert.deepStrictEqual(loaded.dimensions.map(d => d.name + ': ' + d.options.map(o => o.id + '/' + o.count).join(', ')), ['Language: English/4, Armenian/4', 'Theme: Light/4, Dark/4']);
		assert.deepStrictEqual(loaded.variants.map(v => v.id), ['English · Light', 'Armenian · Dark']);
		await importAll(env, loaded, {screens: ['desktop'], variants: ['Armenian · Dark']}, 'single');
		assert.deepStrictEqual(env.figma.root.children[0].children.map(c => c.name), ['Desktop — Armenian · Dark']);
		const plain = await load(makeFigma(), [synthetic()]);
		assert.strictEqual(plain.dimensions, null, 'flat variants: no dimensions');
	});

	// one capture with the given text nodes ({s, ffs?, ff, fw}) on a desktop page
	const textFile = texts => ({version: 1, project: 'Fonts', captures: [{name: 'Fonts', group: 'Pages', screen: {id: 'desktop', label: 'Desktop', width: 800, height: 600}, variant: null, width: 800, height: 600,
		root: {t: 'f', n: 'page', x: 0, y: 0, w: 800, h: 600, bg: [1, 1, 1, 1], ch: texts.map((x, i) => Object.assign({t: 't', x: 10, y: 10 + i * 40, w: 400, h: 30, fs: 16, fw: 400, it: false, lh: 24, ls: 0, c: [0, 0, 0, 1], tc: 'none', td: 'none', al: 'left', multi: false}, x))}}]});
	const textNodes = env => {
		const out = [];
		(function w(n) { if (n.type === 'TEXT') out.push(n); (n.children || []).forEach(w); })(env.figma.root.children[0]);
		return out.filter(t => t.fontSize === 16);
	};
	const INTER = ['Inter', ['Regular', 'Medium', 'Semi Bold', 'SemiBold', 'Bold', 'Italic']];

	await test('fonts per script: Armenian letters get an installed Armenian font, Latin letters the page font', async () => {
		const env = makeFigma({available: [INTER, ['Sylfaen', ['Regular']], ['Roboto Mono', ['Regular']], ['Fancy', ['Regular', 'Bold']]]});
		const stack = ['Noto Sans Armenian', 'Inter', 'sans-serif'];
		const text = await importAll(env, await load(env, [textFile([
			{s: 'Ինչու Fixture', ffs: stack, ff: stack[0]},           // mixed
			{s: 'Shop the collection', ffs: stack, ff: stack[0]},     // Latin only on an Armenian page
			{s: '«Բարև», 12 500 ֏', ffs: stack, ff: stack[0]},       // Armenian with punctuation and digits
			{s: 'Price: 24 500 ֏', ff: 'Inter'},                     // old capture (no ffs), dram sign in an Inter text
			{s: 'const x = 1', ffs: ['ui-monospace', 'Consolas', 'monospace'], ff: 'ui-monospace'},
			{s: 'Semi bold in a family with Regular and Bold', ffs: ['Fancy'], ff: 'Fancy', fw: 600},
		])]), null, 'single');
		const [mixed, latin, arm, dram, mono, fancy] = textNodes(env);
		assert.deepStrictEqual([mixed.fontName.family, mixed.ranges.map(r => r.text + '=' + r.font.family)], ['Sylfaen', ['Fixture=Inter']], 'mixed text: two fonts');
		assert.deepStrictEqual([latin.fontName.family, latin.ranges.length], ['Inter', 0], 'Latin-only text stays in Inter');
		assert.deepStrictEqual([arm.fontName.family, arm.ranges.length], ['Sylfaen', 0], 'punctuation and digits stay with the Armenian run');
		assert.deepStrictEqual([dram.fontName.family, dram.ranges.map(r => r.text + '=' + r.font.family)], ['Inter', ['֏=Sylfaen']], 'old captures get it too');
		assert.strictEqual(mono.fontName.family, 'Roboto Mono', 'ui-monospace -> a real monospace font');
		assert.deepStrictEqual(fancy.fontName, {family: 'Fancy', style: 'Bold'}, 'nearest installed weight');
		assert(/Armenian letters: Sylfaen/.test(text), text);
		assert(/Noto Sans Armenian \(Armenian letters\) → Sylfaen\n/.test(text), 'missing family reported once:\n' + text);
		assert(!/ui-monospace/.test(text), 'generic names are not reported as missing:\n' + text);
	});

	await test('page\'s Armenian font missing → Calibri even when Sylfaen is installed (the owner\'s choice); an installed Noto Sans Armenian is used as is', async () => {
		const env = makeFigma({available: [INTER, ['Sylfaen', ['Regular']], ['Segoe UI', ['Regular', 'Bold']], ['Calibri', ['Regular', 'Bold']]]});
		await importAll(env, await load(env, [textFile([{s: 'Բարև Fixture', ffs: ['Noto Sans Armenian', 'Inter'], ff: 'Noto Sans Armenian', fw: 700}])]), null, 'single');
		const [t] = textNodes(env);
		assert.deepStrictEqual([t.fontName, t.ranges.map(r => r.font.family)], [{family: 'Calibri', style: 'Bold'}, ['Inter']]);
		const env2 = makeFigma({available: [INTER, ['Noto Sans Armenian', ['Regular', 'Bold']]]});
		const text2 = await importAll(env2, await load(env2, [textFile([{s: 'Բարև', ffs: ['Noto Sans Armenian', 'Inter'], ff: 'Noto Sans Armenian'}])]), null, 'single');
		assert.strictEqual(textNodes(env2)[0].fontName.family, 'Noto Sans Armenian');
		assert(!/Missing fonts/.test(text2), text2);
	});

	await test('CSS transforms: rotation around the origin, uniform scale with rescale()', async () => {
		const env = makeFigma();
		const r = -8 * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
		const box = (n, x, y, w, h, tf) => ({t: 'f', n, x, y, w, h, bg: [1, 0.6, 0, 1], ch: [], tf});
		const data = textFile([]);
		data.captures[0].root.ch = [
			box('rotated', 100, 50, 120, 40, {a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0, ox: 60, oy: 20}), // rotate(-8deg), origin center
			box('scaled', 100, 200, 100, 40, {a: 0.7, b: 0, c: 0, d: 0.7, e: 0, f: 0, ox: 0, oy: 0}),         // scale(.7), origin left top
			box('moved', 100, 300, 50, 50, {a: 1, b: 0, c: 0, d: 1, e: 30, f: -10, ox: 25, oy: 25}),         // translate(30px, -10px)
		];
		await importAll(env, await load(env, [data]), null, 'single');
		const frames = {};
		(function w(n) { if (n.type === 'FRAME') frames[n.name] = n; (n.children || []).forEach(w); })(env.figma.root.children[0]);
		const round = m => m.map(row => row.map(v => Math.round(v * 1000) / 1000 + 0));
		// the rotated box turns around its centre: centre stays at (160, 70)
		const rt = frames.rotated.relativeTransform;
		const cx = rt[0][0] * 60 + rt[0][1] * 20 + rt[0][2], cy = rt[1][0] * 60 + rt[1][1] * 20 + rt[1][2];
		assert.deepStrictEqual([Math.round(cx * 1000) / 1000, Math.round(cy * 1000) / 1000], [160, 70], 'centre stays put');
		assert.strictEqual(Math.round(Math.atan2(rt[1][0], rt[0][0]) * 180 / Math.PI), -8);
		assert.deepStrictEqual([frames.rotated.width, frames.rotated.height], [120, 40], 'unrotated size kept');
		assert.strictEqual(frames.scaled.rescaled, 0.7);
		assert.deepStrictEqual(round(frames.scaled.relativeTransform), [[1, 0, 100], [0, 1, 200]], 'scaled from its top-left corner');
		assert.deepStrictEqual(round(frames.moved.relativeTransform), [[1, 0, 130], [0, 1, 290]], 'translated');
	});

	await test('clip-path → mask first, the frame\'s fill moved under it; vertical text turned 90°', async () => {
		const env = makeFigma();
		const data = textFile([{s: 'vertical', ff: 'Inter', vt: true, x: 500, y: 20, w: 24, h: 90}]);
		data.captures[0].root.ch.push({t: 'f', n: 'slanted', x: 20, y: 300, w: 320, h: 50, bg: [0.88, 0.19, 0.19, 1], cp: 'M0 0 L320 0 L256 50 L0 50 Z',
			ch: [{t: 't', s: 'Slanted', x: 32, y: 312, w: 100, h: 24, ff: 'Inter', fs: 17, fw: 400, lh: 24, c: [1, 1, 1, 1], al: 'left', multi: false}]});
		const text = await importAll(env, await load(env, [data]), null, 'single');
		let slanted, vert;
		(function w(n) { if (n.name === 'slanted') slanted = n; if (n.type === 'TEXT' && n.characters === 'vertical') vert = n; (n.children || []).forEach(w); })(env.figma.root.children[0]);
		assert.deepStrictEqual(slanted.children.map(c => c.type + (c.isMask ? ' (mask)' : '')), ['VECTOR (mask)', 'RECT', 'TEXT'], 'mask, then the frame\'s look, then the content');
		assert.strictEqual(slanted.fills.length, 0, 'the frame itself has no fill left');
		assert.strictEqual(slanted.children[1].fills[0].type, 'SOLID');
		assert.deepStrictEqual(vert.relativeTransform, [[0, -1, 524], [1, 0, 20]], 'turned clockwise into its box');
		assert(!/clip-path not applied/.test(text), text);
	});

	await test('"Use Auto Layout": verified flex containers become Auto Layout frames; absolute children stay put', async () => {
		const row = () => ({t: 'f', n: 'nav', x: 100, y: 50, w: 400, h: 40, bg: null, lay: {d: 'H', gap: 24, p: [4, 10, 4, 10], main: 'MIN', cross: 'CENTER'}, ch: [
			{t: 'f', n: 'a', x: 110, y: 60, w: 50, h: 20, bg: [0, 0, 1, 1], ch: []},
			{t: 'f', n: 'b', x: 184, y: 60, w: 60, h: 20, bg: [0, 0, 1, 1], ch: []},
			{t: 'f', n: 'badge', x: 480, y: 44, w: 18, h: 18, bg: [1, 0, 0, 1], abs: true, ch: []},
		]});
		const make = async (autoLayout, storage) => {
			const env = makeFigma({storage});
			const data = textFile([]);
			data.captures[0].root.ch = [row()];
			const loaded = await load(env, [data]);
			await env.send({type: 'import', layout: 'single', screens: loaded.screens.map(s => s.id), autoLayout});
			let nav;
			(function w(n) { if (n.name === 'nav') nav = n; (n.children || []).forEach(w); })(env.figma.root.children[0]);
			return {env, nav};
		};
		const on = await make(true);
		assert.deepStrictEqual([on.nav.layoutMode, on.nav.itemSpacing, on.nav.paddingLeft, on.nav.paddingTop, on.nav.primaryAxisAlignItems, on.nav.counterAxisAlignItems], ['HORIZONTAL', 24, 10, 4, 'MIN', 'CENTER']);
		assert.deepStrictEqual([on.nav.width, on.nav.height], [400, 40], 'keeps its size');
		const badge = on.nav.children.find(c => c.name === 'badge');
		assert.deepStrictEqual([badge.layoutPositioning, badge.x, badge.y], ['ABSOLUTE', 380, -6], 'absolute child keeps its place');
		assert.strictEqual(on.env.storage.autoLayout, true, 'choice remembered');
		const off = await make(false);
		assert.strictEqual(off.nav.layoutMode, undefined, 'off: exact positions, no Auto Layout');
		const remembered = makeFigma({storage: {autoLayout: true}});
		await new Promise(r => setImmediate(r));
		assert.strictEqual(remembered.messages.find(m => m.type === 'settings').autoLayout, true);
	});

	await test('not a capture file → clear error', async () => {
		const env = makeFigma();
		const out = await env.send({type: 'load', files: [{hello: 'world'}]});
		assert.strictEqual(out[0].type, 'error');
		assert(/not an html2frame capture/.test(out[0].text), out[0].text);
	});

	console.log(failed ? '\n' + failed + ' test(s) failed.' : '\nAll tests passed.');
	process.exit(failed ? 1 : 0);
})();
