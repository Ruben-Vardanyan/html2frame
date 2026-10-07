// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// code.js — html2frame Figma plugin (v1). Rebuilds captures (docs/FORMAT.md) as frames, text, vectors and
// images. All screens on the current page (D14) or one Figma page per screen (D4); one row per group with a label
// above; frames named "Page — Variant" (D6).
// Every node carries absolute page coordinates; children are placed relative to their parent.
// Started from the prototype plugin (font resolution, frame/text/svg/image building).

figma.showUI(__html__, {width: 380, height: 600, themeColors: true});

const GAP_X = 200, GAP_Y = 400, LABEL_SIZE = 64, LABEL_SPACE = 120, TITLE_SPACE = 240, SECTION_PAD = 120;
const WEIGHTS = {100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'};
const fontCache = {};
let fallbacks = {}; // "Family Style" wanted -> "Family Style" used
let scriptFonts = {}; // "Armenian" -> families used for Armenian letters
const imageHashes = new Map(); // base64 -> image hash

// ---- fonts ------------------------------------------------------------------------------------------
// A text node carries the page's whole font stack (ffs). Like the browser, the plugin picks a font per
// script inside one text layer: letters of a script listed here get a font made for it (from the stack,
// else a fallback installed in this Figma); everything else gets the first ordinary font of the stack.
// Latin, Cyrillic and Greek are covered by common fonts such as Inter.

const SCRIPTS = {
	armenian: {label: 'Armenian', re: /[԰-֏ﬓ-ﬗ]/, family: /armenian/i,
		// the owner's choice: Calibri whenever the page's own Armenian font is not installed; the rest only if
		// Calibri is missing too (e.g. on a Mac)
		fallbacks: ['Calibri', 'Noto Sans Armenian', 'Noto Serif Armenian', 'Arian AMU', 'GHEA Grapalat', 'Mardoto', 'Sylfaen', 'Segoe UI', 'Mshtakan', 'Arial Unicode MS']},
	georgian: {label: 'Georgian', re: /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/, family: /georgian/i,
		fallbacks: ['Noto Sans Georgian', 'Noto Serif Georgian', 'BPG Arial', 'Sylfaen', 'Segoe UI', 'Arial Unicode MS']},
};
// families made for one script: never used for other letters (they often have no Latin)
const SCRIPT_FAMILY = /armenian|georgian|arabic|hebrew|devanagari|bengali|thai|khmer|lao\b|myanmar|ethiopic|tamil|telugu|kannada|malayalam|gujarati|gurmukhi|sinhala|tibetan|cjk/i;
// CSS generic names are not fonts: map them to real ones
const GENERIC = {
	'serif': ['Georgia', 'Noto Serif', 'Times New Roman'], 'ui-serif': ['Georgia', 'Noto Serif', 'Times New Roman'],
	'monospace': ['Roboto Mono', 'Consolas', 'Courier New'], 'ui-monospace': ['Roboto Mono', 'Consolas', 'Courier New'],
	'sans-serif': ['Inter'], 'ui-sans-serif': ['Inter'], 'system-ui': ['Inter'], '-apple-system': ['Inter'], 'blinkmacsystemfont': ['Inter'], 'ui-rounded': ['Inter'],
	'cursive': ['Inter'], 'fantasy': ['Inter'], 'emoji': ['Inter'], 'math': ['Inter'], 'fangsong': ['Inter'],
};
const STYLE_WEIGHT = {thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900};
let available = null; // Map family -> Set(styles) from figma.listAvailableFontsAsync(), or null when unknown

async function loadAvailableFonts() {
	if (available) return;
	try {
		const list = await figma.listAvailableFontsAsync();
		if (!list || !list.length) return; // unknown: just try loading
		available = new Map();
		for (const f of list) {
			if (!available.has(f.fontName.family)) available.set(f.fontName.family, new Set());
			available.get(f.fontName.family).add(f.fontName.style);
		}
	} catch (e) {}
}

function styleName(fw, it) {
	const w = WEIGHTS[Math.round(fw / 100) * 100] || 'Regular';
	if (!it) return w;
	return w === 'Regular' ? 'Italic' : w + ' Italic';
}

function spaced(style) {
	return style.replace('SemiBold', 'Semi Bold').replace('ExtraBold', 'Extra Bold').replace('ExtraLight', 'Extra Light');
}

async function tryLoad(font) {
	try {
		await figma.loadFontAsync(font);
		return true;
	} catch (e) {
		return false;
	}
}

// styles to try for a family: the exact one, then (when the family's styles are known) the nearest weight
function styleCandidates(family, fw, it) {
	const want = styleName(fw, it);
	const list = [want, spaced(want)];
	if (available && available.has(family)) {
		const styles = available.get(family);
		const parse = s => {
			const l = s.toLowerCase();
			const base = l.replace(/italic|oblique/g, '').replace(/\s+/g, '') || 'regular';
			return {s, italic: /italic|oblique/.test(l), w: STYLE_WEIGHT[base] || 400};
		};
		const ranked = [...styles].map(parse).sort((a, b) => ((a.italic !== it) * 1000 + Math.abs(a.w - fw)) - ((b.italic !== it) * 1000 + Math.abs(b.w - fw)));
		return [...new Set(list.filter(s => styles.has(s)).concat(ranked.map(r => r.s)))];
	}
	return [...new Set(list.concat('Regular'))];
}

async function loadFamily(family, fw, it) {
	if (available && !available.has(family)) return null;
	for (const style of styleCandidates(family, fw, it)) {
		if (await tryLoad({family, style})) return {family, style};
	}
	return null;
}

// The font for one script (null = ordinary letters) from a CSS font stack, loaded and ready.
async function pickFont(stack, fw, it, script) {
	const key = stack.join(',') + '|' + fw + '|' + it + '|' + (script || '');
	if (fontCache[key]) return fontCache[key];
	const sc = script ? SCRIPTS[script] : null;
	const families = [];
	let wanted = null; // the family the page asked for, to report when it is missing
	for (const f of stack) {
		const g = GENERIC[f.toLowerCase()];
		if (g) {
			if (!sc) families.push(...g);
			continue;
		}
		if (sc ? sc.family.test(f) : !SCRIPT_FAMILY.test(f)) {
			families.push(f);
			if (!wanted) wanted = f;
		}
	}
	families.push(...(sc ? sc.fallbacks : ['Inter']));
	let chosen = null;
	for (const f of [...new Set(families)]) {
		if ((chosen = await loadFamily(f, fw, it))) break;
	}
	if (!chosen) {
		chosen = {family: 'Inter', style: 'Regular'};
		await tryLoad(chosen);
	}
	// report a missing family once ("Noto Sans Armenian → Sylfaen"), a missing style of an installed one by style
	const style = styleName(fw, it);
	const suffix = sc ? ' (' + sc.label + ' letters)' : '';
	if (wanted && chosen.family !== wanted) fallbacks[wanted + suffix] = chosen.family;
	else if (wanted && chosen.style !== style && chosen.style !== spaced(style)) fallbacks[wanted + ' ' + style + suffix] = chosen.family + ' ' + chosen.style;
	if (sc) {
		scriptFonts[sc.label] = scriptFonts[sc.label] || new Set();
		scriptFonts[sc.label].add(chosen.family);
	}
	fontCache[key] = chosen;
	return chosen;
}

// for labels and other plugin text
function resolveFont(ff, fw, it) {
	return pickFont([ff], fw, it, null);
}

// Split a string into runs by script: [{start, end, script}] (UTF-16 positions, as Figma's ranges use).
// Spaces, digits and punctuation join the run around them.
function scriptRuns(s) {
	const cls = [];
	for (let i = 0; i < s.length;) {
		const cp = s.codePointAt(i), len = cp > 0xffff ? 2 : 1, ch = s.slice(i, i + len);
		let c;
		for (const k of Object.keys(SCRIPTS)) if (SCRIPTS[k].re.test(ch)) c = k;
		if (c === undefined) c = /\p{L}/u.test(ch) ? null : 'neutral';
		for (let j = 0; j < len; j++) cls.push(c);
		i += len;
	}
	// neutrals join the run before them; leading ones the first real run ("«Բարև»" stays one Armenian run)
	const firstReal = cls.find(c => c !== 'neutral');
	let prev = firstReal === undefined ? null : firstReal;
	for (let i = 0; i < cls.length; i++) {
		if (cls[i] === 'neutral') cls[i] = prev; else prev = cls[i];
	}
	const runs = [];
	for (let i = 0; i < cls.length; i++) {
		const c = cls[i] || null;
		if (runs.length && runs[runs.length - 1].script === c) runs[runs.length - 1].end = i + 1;
		else runs.push({start: i, end: i + 1, script: c});
	}
	return runs.length ? runs : [{start: 0, end: 0, script: null}];
}

// fonts for a text node: {base, runs: [{start, end, font}]}
async function textFonts(n) {
	const stack = n.ffs && n.ffs.length ? n.ffs : [n.ff || 'Inter'];
	const runs = scriptRuns(n.s || '');
	for (const r of runs) r.font = await pickFont(stack, n.fw || 400, !!n.it, r.script);
	return {base: runs[0].font, runs};
}

async function preloadFonts(node) {
	if (node.t === 't') await textFonts(node);
	for (const c of node.ch || []) await preloadFonts(c);
}

// ---- paints -----------------------------------------------------------------------------------------

function solid(c) {
	return {type: 'SOLID', color: {r: c[0], g: c[1], b: c[2]}, opacity: c[3] === undefined ? 1 : c[3]};
}

function clamp01(v) {
	return Math.max(0, Math.min(1, Number(v) || 0));
}

// CSS angle (0° = to top, 90° = to right) -> Figma gradientTransform; see docs/FORMAT.md
function gradientPaint(l) {
	const t = (Number(l.angle) || 0) * Math.PI / 180;
	const vx = Math.sin(t), vy = -Math.cos(t);
	const p0x = 0.5 - vx / 2, p0y = 0.5 - vy / 2;
	const len2 = vx * vx + vy * vy;
	const a = vx / len2, b = vy / len2, c = -(a * p0x + b * p0y);
	const d = -vy / len2, e = vx / len2, f = 0.5 - (d * p0x + e * p0y);
	// a stop without a colour (older captures dropped fully transparent ones) is transparent
	const stops = l.stops.map(s => {
		const c = s.c || [0, 0, 0, 0];
		return {position: clamp01(s.p), color: {r: c[0], g: c[1], b: c[2], a: c[3] === undefined ? 1 : c[3]}};
	});
	stops.sort((x, y) => x.position - y.position);
	return {type: 'GRADIENT_LINEAR', gradientTransform: [[a, b, c], [d, e, f]], gradientStops: stops};
}

function imageHash(data) {
	if (!imageHashes.has(data)) imageHashes.set(data, figma.createImage(figma.base64Decode(data)).hash);
	return imageHashes.get(data);
}

function imagePaint(data, fit) {
	return {type: 'IMAGE', imageHash: imageHash(data), scaleMode: fit === 'contain' ? 'FIT' : 'FILL'};
}

// background colour first (bottom), then the extra layers, already in Figma order (last = top)
function framePaints(n, warn) {
	const fills = n.bg ? [solid(n.bg)] : [];
	for (const l of n.layers || []) {
		try {
			if (l.type === 'gradient' && l.stops && l.stops.length >= 2) fills.push(gradientPaint(l));
			else if (l.type === 'image' && l.data) fills.push(imagePaint(l.data, l.fit));
		} catch (e) {
			warn('background layer skipped on ' + (n.n || 'frame') + ': ' + (e && e.message ? e.message : e));
		}
	}
	return fills;
}

function shadowEffect(s) {
	return {
		type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
		color: {r: s.c[0], g: s.c[1], b: s.c[2], a: s.c[3] === undefined ? 1 : s.c[3]},
		offset: {x: s.x || 0, y: s.y || 0}, radius: s.blur || 0, spread: s.spread || 0,
	};
}

const BLEND_MODES = {
	'multiply': 'MULTIPLY', 'screen': 'SCREEN', 'overlay': 'OVERLAY', 'darken': 'DARKEN', 'lighten': 'LIGHTEN',
	'color-dodge': 'COLOR_DODGE', 'color-burn': 'COLOR_BURN', 'hard-light': 'HARD_LIGHT', 'soft-light': 'SOFT_LIGHT',
	'difference': 'DIFFERENCE', 'exclusion': 'EXCLUSION', 'hue': 'HUE', 'saturation': 'SATURATION', 'color': 'COLOR', 'luminosity': 'LUMINOSITY',
};

// mix-blend-mode -> blendMode; filter: blur() -> layer blur; backdrop-filter: blur() -> background blur.
// Figma's blur radius is about twice the CSS value (CSS blur() takes the standard deviation).
function applyEffects(node, n, warn) {
	try {
		if (n.blend && BLEND_MODES[n.blend]) node.blendMode = BLEND_MODES[n.blend];
		const blurs = [];
		if (n.blur) blurs.push({type: 'LAYER_BLUR', radius: n.blur * 2, visible: true});
		if (n.bblur) blurs.push({type: 'BACKGROUND_BLUR', radius: n.bblur * 2, visible: true});
		if (!blurs.length) return;
		const before = node.effects || [];
		try {
			node.effects = before.concat(blurs);
		} catch (e) {
			// newer Figma versions describe blurs with a blurType
			node.effects = before.concat(blurs.map(b => Object.assign({blurType: 'NORMAL'}, b)));
		}
	} catch (e) {
		warn('blur or blend not applied on ' + (n.n || 'node') + ': ' + (e && e.message ? e.message : e));
	}
}

function setRadius(node, r) {
	if (!r) return;
	node.topLeftRadius = r.tl || 0;
	node.topRightRadius = r.tr || 0;
	node.bottomRightRadius = r.br || 0;
	node.bottomLeftRadius = r.bl || 0;
}

function applyBox(f, n, warn) {
	f.fills = framePaints(n, warn);
	setRadius(f, n.br);
	if (n.bd) {
		f.strokes = [solid(n.bd.c)];
		f.strokeAlign = 'INSIDE';
		const w = n.bd.w;
		if (w[0] === w[1] && w[1] === w[2] && w[2] === w[3]) {
			f.strokeWeight = w[0];
		} else {
			f.strokeTopWeight = w[0];
			f.strokeRightWeight = w[1];
			f.strokeBottomWeight = w[2];
			f.strokeLeftWeight = w[3];
		}
		if (n.bd.dash) f.dashPattern = [4, 3];
	}
	if (n.sh && n.sh.length) f.effects = n.sh.map(shadowEffect);
	if (n.op !== undefined && n.op < 1) f.opacity = n.op;
	f.clipsContent = !!n.clip;
}

// CSS transform (n.tf: matrix a b c d e f around origin ox oy, see extract.js) on a node already built at its
// untransformed place (x, y in the parent). Scale: uniform -> rescale() (children, text and strokes follow);
// non-uniform -> the box only. Rotation and offset -> relativeTransform, around the same origin. Skew is dropped.
function applyTransform(node, n, x, y, warn) {
	const t = n.tf;
	if (!t) return;
	try {
		const sx = Math.hypot(t.a, t.b);
		if (!(sx > 0)) return;
		const sy = Math.abs((t.a * t.d - t.b * t.c) / sx);
		let kx = 1, ky = 1;
		if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
			if (Math.abs(sx - sy) < 0.001 && typeof node.rescale === 'function') {
				node.rescale(sx);
				kx = ky = sx;
			} else {
				node.resize(Math.max(node.width * sx, 0.01), Math.max(node.height * sy, 0.01));
				kx = sx;
				ky = sy;
			}
		}
		const r = Math.atan2(t.b, t.a), cos = Math.cos(r), sin = Math.sin(r);
		const ox = t.ox * kx, oy = t.oy * ky; // origin on the scaled node
		node.relativeTransform = [
			[cos, -sin, x + t.ox - (cos * ox - sin * oy) + t.e],
			[sin, cos, y + t.oy - (sin * ox + cos * oy) + t.f],
		];
	} catch (e) {
		warn('transform not applied on ' + (n.n || 'node') + ': ' + (e && e.message ? e.message : e));
	}
}

// Option "Use Auto Layout": flex containers that capture verified (n.lay) become Auto Layout frames.
let USE_AUTO_LAYOUT = false;

// Direction, padding, gap and alignment from n.lay; the frame keeps its measured size, child frames keep
// theirs, single-line text hugs. Children that are out of the flow stay absolute at their place: CSS
// absolute/fixed (abs), rotated or vertical ones (Figma would lay out their rotated bounds), and helpers
// that are not captured nodes (a clip-path mask and its background).
function applyAutoLayout(f, n, made, warn) {
	const a = n.lay;
	try {
		const kids = [...f.children];
		const place = new Map(kids.map(k => [k, [k.x, k.y]]));
		const isAbsolute = k => {
			const c = made.get(k);
			return !c || c.abs || c.tf || c.vt;
		};
		f.layoutMode = a.d === 'H' ? 'HORIZONTAL' : 'VERTICAL';
		f.primaryAxisSizingMode = 'FIXED';
		f.counterAxisSizingMode = 'FIXED';
		f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
		f.paddingTop = a.p[0];
		f.paddingRight = a.p[1];
		f.paddingBottom = a.p[2];
		f.paddingLeft = a.p[3];
		f.itemSpacing = a.gap;
		f.primaryAxisAlignItems = a.main;
		f.counterAxisAlignItems = a.cross;
		for (const k of kids) {
			if (!isAbsolute(k)) continue;
			k.layoutPositioning = 'ABSOLUTE';
			const [x, y] = place.get(k);
			k.x = x;
			k.y = y;
		}
	} catch (e) {
		warn('Auto Layout not applied on ' + (n.n || 'frame') + ': ' + (e && e.message ? e.message : e));
	}
}

// CSS clip-path (n.cp: an SVG path in the frame's own pixels) -> a mask as the frame's first child, so the
// children built after it are clipped. The frame's own fill and border move into a rectangle under the
// mask (a frame's fills are not masked by its children); text stays editable.
function clipFrame(f, n, warn) {
	try {
		const w = Math.max(n.w, 0.01), h = Math.max(n.h, 0.01);
		const holder = figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><path d="' + n.cp + '" fill="#000000"/></svg>');
		f.appendChild(holder);
		const mask = figma.flatten([holder], f, 0);
		mask.name = 'clip-path';
		mask.x = 0;
		mask.y = 0;
		mask.isMask = true;
		const look = figma.createRectangle();
		look.name = 'background';
		look.resize(w, h);
		look.fills = f.fills;
		if (n.bd) {
			look.strokes = f.strokes;
			look.strokeAlign = 'INSIDE';
			look.strokeWeight = Math.max(...n.bd.w);
		}
		setRadius(look, n.br);
		f.appendChild(look);
		f.fills = [];
		f.strokes = [];
	} catch (e) {
		warn('clip-path not applied on ' + (n.n || 'frame') + ': ' + (e && e.message ? e.message : e));
	}
}

function placeholder(parent, n, ox, oy, name) {
	const r = figma.createRectangle();
	r.name = name;
	r.resize(Math.max(n.w, 1), Math.max(n.h, 1));
	r.x = n.x - ox;
	r.y = n.y - oy;
	r.fills = [solid([0.87, 0.88, 0.92, 1])];
	parent.appendChild(r);
	return r;
}

// ---- nodes ------------------------------------------------------------------------------------------

async function build(parent, n, ox, oy, warn) {
	if (n.t === 'f') {
		const f = figma.createFrame();
		f.name = n.n || 'frame';
		f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
		f.x = n.x - ox;
		f.y = n.y - oy;
		applyBox(f, n, warn);
		applyEffects(f, n, warn);
		if (n.cp) clipFrame(f, n, warn);
		parent.appendChild(f);
		const made = new Map(); // Figma node -> its captured node
		for (const c of n.ch || []) {
			const k = await build(f, c, n.x, n.y, warn);
			if (k) made.set(k, c);
		}
		if (USE_AUTO_LAYOUT && n.lay) applyAutoLayout(f, n, made, warn);
		applyTransform(f, n, n.x - ox, n.y - oy, warn);
		return f;
	}
	if (n.t === 't') {
		const t = figma.createText();
		const fonts = await textFonts(n);
		t.fontName = fonts.base;
		t.characters = n.s;
		for (const r of fonts.runs) {
			if (r.end > r.start && (r.font.family !== fonts.base.family || r.font.style !== fonts.base.style)) t.setRangeFontName(r.start, r.end, r.font);
		}
		t.fontSize = n.fs;
		t.fills = [solid(n.c)];
		if (n.ts && n.ts.length) t.effects = n.ts.map(sh => shadowEffect(Object.assign({spread: 0}, sh)));
		if (n.ls) t.letterSpacing = {value: n.ls, unit: 'PIXELS'};
		t.lineHeight = n.lh ? {value: n.lh, unit: 'PIXELS'} : {unit: 'AUTO'};
		t.textCase = {upper: 'UPPER', lower: 'LOWER', title: 'TITLE'}[n.tc] || 'ORIGINAL';
		t.textDecoration = {underline: 'UNDERLINE', strike: 'STRIKETHROUGH'}[n.td] || 'NONE';
		t.textAlignHorizontal = {center: 'CENTER', right: 'RIGHT'}[n.al] || 'LEFT';
		t.name = n.s.length > 40 ? n.s.slice(0, 40) + '…' : n.s;
		parent.appendChild(t);
		if (n.multi || n.fixed) {
			t.textAutoResize = 'HEIGHT';
			t.resize(Math.max(n.w + (n.fixed ? 0 : 2), 1), Math.max(n.h, 1));
			t.x = n.x - ox - (n.fixed ? 0 : 1);
		} else {
			t.textAutoResize = 'WIDTH_AND_HEIGHT';
			let x = n.x;
			if (n.al === 'center') x = n.x + (n.w - t.width) / 2;
			else if (n.al === 'right') x = n.x + n.w - t.width;
			t.x = x - ox;
		}
		t.y = n.y - oy;
		// vertical writing: the line is built horizontally, then turned 90° clockwise into its box
		// (top-right corner = the start of the line); every glyph turns, CJK included
		if (n.vt) t.relativeTransform = [[0, -1, n.x - ox + n.w], [1, 0, n.y - oy]];
		return t;
	}
	if (n.t === 'svg') {
		try {
			const v = figma.createNodeFromSvg(n.svg);
			v.name = n.n || 'svg';
			v.x = n.x - ox;
			v.y = n.y - oy;
			if (n.w > 0 && n.h > 0) v.resize(n.w, n.h);
			v.fills = [];
			v.clipsContent = false;
			applyEffects(v, n, warn);
			parent.appendChild(v);
			applyTransform(v, n, n.x - ox, n.y - oy, warn);
			return v;
		} catch (e) {
			// unsupported svg: leave a placeholder box so the layout stays readable
			return placeholder(parent, n, ox, oy, 'svg (not imported)');
		}
	}
	if (n.t === 'img') {
		if (!n.data) {
			warn('image without data: ' + (n.n || 'image'));
			return placeholder(parent, n, ox, oy, (n.n || 'image') + ' (no data)');
		}
		try {
			const paint = imagePaint(n.data, n.fit);
			const r = figma.createRectangle();
			r.name = n.n || 'image';
			r.resize(Math.max(n.w, 1), Math.max(n.h, 1));
			r.x = n.x - ox;
			r.y = n.y - oy;
			r.fills = [paint];
			setRadius(r, n.r);
			applyEffects(r, n, warn);
			parent.appendChild(r);
			applyTransform(r, n, n.x - ox, n.y - oy, warn);
			return r;
		} catch (e) {
			warn('image not imported: ' + (n.n || 'image') + ' (' + (e && e.message ? e.message : e) + ')');
			return placeholder(parent, n, ox, oy, (n.n || 'image') + ' (not imported)');
		}
	}
	return null;
}

// ---- files ------------------------------------------------------------------------------------------

// FORMAT v1 ({captures}) or prototype ({pages}, a page array, or one page) -> list of v1 captures.
// A prototype file is a single "Desktop" screen.
function normalise(files) {
	const caps = [];
	let project = null;
	for (const d of files) {
		if (d && Array.isArray(d.captures)) {
			project = project || d.project || null;
			for (const c of d.captures) caps.push(c);
			continue;
		}
		const pages = Array.isArray(d) ? d : d && Array.isArray(d.pages) ? d.pages : [d];
		for (const p of pages) {
			caps.push(Object.assign({}, p, {
				screen: p.screen || {id: 'desktop', label: 'Desktop', width: p.width, height: 900, orientation: 'landscape'},
				variant: p.variant || null,
			}));
		}
	}
	for (const c of caps) {
		if (!c || !c.root || !(c.width > 0) || !(c.height > 0)) throw new Error('This is not an html2frame capture file (a page has no root, width or height).');
	}
	if (!caps.length) throw new Error('The file has no pages.');
	return {project, captures: caps};
}

function variantCount(caps) {
	return new Set(caps.map(c => c.variant || '')).size;
}

// D4: "Desktop", "Phone portrait"; the variant is appended when the file has several
function pageNameOf(c, multiVariant) {
	const label = (c.screen && c.screen.label) || 'Desktop';
	return multiVariant && c.variant ? label + ' — ' + c.variant : label;
}

function groupOf(c) {
	return c.group || 'Pages';
}

// D6: "Home — English"
function frameNameOf(c) {
	return c.variant ? c.name + ' — ' + c.variant : c.name || 'Page';
}

function screenIdOf(c) {
	return (c.screen && (c.screen.id || c.screen.label)) || 'desktop';
}

// What the UI offers to choose from, in file order: screen sizes, variants and groups, plus how many captures
// each screen × variant × group combination has (so the UI can show the exact frame count).
function choicesOf(caps) {
	const screens = [], variants = [], groups = [], combos = {};
	const add = (list, key, make) => {
		let it = list.find(x => x.id === key);
		if (!it) list.push(it = make());
		it.count++;
	};
	for (const c of caps) {
		const s = screenIdOf(c), v = c.variant || '', g = groupOf(c);
		add(screens, s, () => ({id: s, label: (c.screen && c.screen.label) || 'Desktop', width: c.screen && c.screen.width, height: c.screen && c.screen.height, count: 0}));
		add(variants, v, () => ({id: v, label: v || 'Default', parts: c.variantParts || null, count: 0}));
		add(groups, g, () => ({id: g, label: g, count: 0}));
		const k = s + '\n' + v + '\n' + g;
		combos[k] = (combos[k] || 0) + 1;
	}
	// variants made from dimensions (Language × Theme…) carry their parts: offer one list per dimension
	let dimensions = null;
	if (variants.length && variants.every(v => v.parts)) {
		dimensions = [];
		for (const v of variants) {
			for (const [name, option] of Object.entries(v.parts)) {
				let d = dimensions.find(x => x.name === name);
				if (!d) dimensions.push(d = {name, options: []});
				let o = d.options.find(x => x.id === option);
				if (!o) d.options.push(o = {id: option, label: option, count: 0});
				o.count += v.count;
			}
		}
	}
	return {screens, variants, groups, combos, dimensions};
}

// sel: {screens: [ids], variants?: [names], groups?: [names]}. Variants and groups may be left out when the
// file has only one; screens are always required.
function selectCaptures(caps, sel) {
	const pick = (list, value) => !list || list.includes(value);
	if (!sel || !Array.isArray(sel.screens) || !sel.screens.length) throw new Error('Choose at least one screen size.');
	return caps.filter(c => sel.screens.includes(screenIdOf(c)) && pick(sel.variants, c.variant || '') && pick(sel.groups, groupOf(c)));
}

// ---- layout -----------------------------------------------------------------------------------------

// Existing page with that name; else the empty default page of a new file; else a new page.
// If no page can be created (plan limit), fall back to the first page used in this import.
async function targetPage(name, used) {
	const existing = figma.root.children.find(p => p.name === name);
	if (existing) return {page: existing, fallback: false};
	const cur = figma.currentPage;
	if (figma.root.children.length === 1 && cur.children.length === 0 && !used.includes(cur)) {
		cur.name = name;
		return {page: cur, fallback: false};
	}
	try {
		const page = figma.createPage();
		page.name = name;
		return {page, fallback: false};
	} catch (e) {
		return {page: used[0] || cur, fallback: true, reason: e && e.message ? e.message : String(e)};
	}
}

// where new content starts: top-left of an empty page, or below everything already there
function startPoint(page) {
	const kids = page.children;
	if (!kids.length) return {x: 0, y: 0};
	let minX = Infinity, bottom = -Infinity;
	for (const k of kids) {
		minX = Math.min(minX, k.x);
		bottom = Math.max(bottom, k.y + k.height);
	}
	return {x: Math.round(minX), y: Math.round(bottom + GAP_Y)};
}

// a Figma Section on the page, or null where the API has none
function newSection(page, name) {
	if (typeof figma.createSection !== 'function') return null;
	try {
		const s = figma.createSection();
		s.name = name;
		page.appendChild(s);
		return s;
	} catch (e) {
		return null;
	}
}

async function label(page, text, x, y, size) {
	const t = figma.createText();
	t.fontName = await resolveFont('Inter', 700, false);
	t.characters = text;
	t.fontSize = size;
	t.x = x;
	t.y = y;
	page.appendChild(t);
	return t;
}

// layout "single": every screen/variant on the current Figma page, one Section each (D14).
// layout "pages": one Figma page per screen/variant (D4).
async function importCaptures(caps, project, multi, layout) {
	const single = layout !== 'pages';
	const home = figma.currentPage;
	fallbacks = {};
	scriptFonts = {};
	const warnings = [], failures = [];
	const warn = w => {
		if (warnings.length < 200) warnings.push(w);
	};

	figma.ui.postMessage({type: 'progress', text: 'Loading fonts…', done: 0, total: caps.length});
	await loadAvailableFonts();
	await resolveFont('Inter', 700, false);
	for (const c of caps) await preloadFonts(c.root);

	const byPage = new Map();
	for (const c of caps) {
		const name = pageNameOf(c, multi);
		if (!byPage.has(name)) byPage.set(name, []);
		byPage.get(name).push(c);
	}

	const used = [], perPage = [], notes = [];
	let first = null, done = 0;
	for (const [name, list] of byPage) {
		const target = single ? {page: home, fallback: false} : await targetPage(name, used);
		const page = target.page;
		await figma.setCurrentPageAsync(page);
		if (!used.includes(page)) used.push(page);
		if (target.fallback) notes.push('Could not add a Figma page for "' + name + '" (' + target.reason + '); placed it on "' + page.name + '" instead.');

		// a block that shares its page with others is a Figma Section named after the screen/variant;
		// children of a section are placed relative to it
		const start = startPoint(page);
		const boxed = single || target.fallback;
		const section = boxed ? newSection(page, name) : null;
		const parent = section || page;
		const x0 = section ? SECTION_PAD : start.x;
		let y = section ? SECTION_PAD : start.y;
		let right = x0;
		if (section) {
			section.x = start.x;
			section.y = start.y;
		} else if (boxed) {
			await label(page, name, x0, y, LABEL_SIZE * 1.5); // no Sections in this Figma: a big title instead
			y += TITLE_SPACE;
		}
		const rows = [];
		for (const c of list) {
			const g = groupOf(c);
			let row = rows.find(r => r.name === g);
			if (!row) rows.push(row = {name: g, caps: []});
			row.caps.push(c);
		}
		const frames = [];
		for (const row of rows) {
			await label(parent, row.name, x0, y, LABEL_SIZE);
			const top = y + LABEL_SPACE;
			let x = x0, rowH = 0;
			for (const c of row.caps) {
				figma.ui.postMessage({type: 'progress', text: name + ' · ' + frameNameOf(c), done: ++done, total: caps.length});
				try {
					const root = Object.assign({}, c.root, {x: 0, y: 0});
					const frame = await build(parent, root, 0, 0, warn);
					frame.name = frameNameOf(c);
					frame.x = x;
					frame.y = top;
					frame.clipsContent = true;
					frames.push(frame);
				} catch (e) {
					failures.push(name + ' · ' + frameNameOf(c) + ': ' + (e && e.message ? e.message : e));
				}
				x += c.width + GAP_X;
				rowH = Math.max(rowH, c.height);
			}
			right = Math.max(right, x - GAP_X);
			y = top + rowH + GAP_Y;
		}
		if (section) section.resizeWithoutConstraints(Math.max(right + SECTION_PAD, 400), Math.max(y - GAP_Y + SECTION_PAD, 400));
		perPage.push(name + ': ' + frames.length + ' frame(s)');
		if (!first && frames.length) first = {page, nodes: []};
		if (first && first.page === page) first.nodes.push(...(section ? [section] : frames));
	}

	if (first) {
		await figma.setCurrentPageAsync(first.page);
		figma.viewport.scrollAndZoomIntoView(first.nodes);
	}

	const lines = [];
	const total = caps.length - failures.length;
	lines.push('Done: ' + total + ' page(s) imported' + (project ? ' from ' + project : '') + (single ? ' onto "' + home.name + '"' : '') + '.');
	perPage.forEach(l => lines.push('• ' + l));
	notes.forEach(l => lines.push('⚠ ' + l));
	const sf = Object.keys(scriptFonts);
	if (sf.length) {
		lines.push('Fonts for other scripts:');
		sf.forEach(k => lines.push('• ' + k + ' letters: ' + [...scriptFonts[k]].join(', ')));
	}
	const fb = Object.keys(fallbacks);
	if (fb.length) {
		lines.push('Missing fonts:');
		fb.forEach(k => lines.push('• ' + k + ' → ' + fallbacks[k]));
	}
	if (failures.length) {
		lines.push('Failed:');
		failures.forEach(l => lines.push('• ' + l));
	}
	if (warnings.length) {
		lines.push('Warnings:');
		warnings.slice(0, 20).forEach(l => lines.push('• ' + l));
		if (warnings.length > 20) lines.push('• … and ' + (warnings.length - 20) + ' more');
	}
	return {text: lines.join('\n'), imported: total, failures, fallbacks, pages: perPage};
}

// ---- messages ---------------------------------------------------------------------------------------

let loaded = null; // {project, captures}

// the last layout choice is remembered on this computer
Promise.all([figma.clientStorage.getAsync('layout'), figma.clientStorage.getAsync('autoLayout')])
	.then(([v, al]) => figma.ui.postMessage({type: 'settings', layout: v === 'pages' ? 'pages' : 'single', autoLayout: al === true}), () => {});

figma.ui.onmessage = async (msg) => {
	if (msg.type === 'open-repo') return figma.openExternal('https://github.com/Ruben-Vardanyan/html2frame');
	if (msg.type === 'load') {
		try {
			loaded = normalise(msg.files);
			figma.ui.postMessage(Object.assign({type: 'loaded', project: loaded.project, total: loaded.captures.length, source: msg.source}, choicesOf(loaded.captures)));
		} catch (e) {
			loaded = null;
			figma.ui.postMessage({type: 'error', text: e && e.message ? e.message : String(e)});
		}
		return;
	}
	if (msg.type === 'import') {
		if (!loaded) return figma.ui.postMessage({type: 'error', text: 'Load a capture first.'});
		const multi = variantCount(loaded.captures) > 1;
		let caps;
		try {
			caps = selectCaptures(loaded.captures, msg);
		} catch (e) {
			return figma.ui.postMessage({type: 'error', text: e.message});
		}
		if (!caps.length) return figma.ui.postMessage({type: 'error', text: 'Nothing matches that selection.'});
		const layout = msg.layout === 'pages' ? 'pages' : 'single';
		USE_AUTO_LAYOUT = msg.autoLayout === true;
		await figma.clientStorage.setAsync('layout', layout).catch(() => {});
		await figma.clientStorage.setAsync('autoLayout', USE_AUTO_LAYOUT).catch(() => {});
		try {
			const report = await importCaptures(caps, loaded.project, multi, layout);
			figma.ui.postMessage({type: 'done', text: report.text});
		} catch (e) {
			figma.ui.postMessage({type: 'done', text: 'Error: ' + (e && e.message ? e.message : e)});
		}
	}
};
