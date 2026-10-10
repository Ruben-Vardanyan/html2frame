// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// extract.js — runs INSIDE the page (injected by capture.js).
// Walks the rendered DOM and records what is painted, in page coordinates, as a JSON tree
// the Figma plugin rebuilds: frames (boxes), text, svg and images.
// Images are returned as URLs ({src}); capture.js downloads them, so CORS does not matter.
(function () {
	const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|HEAD|TITLE|BR|WBR|AUDIO)$/;
	// elements with no layers to read: capture.js takes a picture of each (`shot`) and imports it as an image
	const SHOT_TAGS = /^(canvas|video|iframe|object|embed)$/;
	let SHOTS = 0;
	const INLINE = /^(inline|contents)$/;
	let OPTS = {replaceText: {}};

	function replaceText(s) {
		for (const [from, to] of Object.entries(OPTS.replaceText || {})) s = s.split(from).join(to);
		return s;
	}

	function rgba(str) {
		if (!str) return null;
		const m = str.match(/rgba?\(([^)]+)\)/);
		if (!m) return null;
		const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(v => (v.endsWith('%') ? parseFloat(v) / 100 : Number(v)));
		const a = p.length > 3 ? p[3] : 1;
		if (a === 0) return null;
		return [p[0] / 255, p[1] / 255, p[2] / 255, a];
	}

	// like rgba(), but a fully transparent colour stays a colour (gradient stops fade to it)
	function rgbaAny(str) {
		const m = str && str.match(/rgba?\(([^)]+)\)/);
		if (!m) return /transparent/.test(str || '') ? [0, 0, 0, 0] : null;
		const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(v => (v.endsWith('%') ? parseFloat(v) / 100 : Number(v)));
		return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
	}

	function px(v) {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : 0;
	}

	function splitTop(str) {
		const out = [];
		let depth = 0, cur = '';
		for (const ch of str) {
			if (ch === '(') depth++;
			if (ch === ')') depth--;
			if (ch === ',' && depth === 0) {
				out.push(cur.trim());
				cur = '';
			} else cur += ch;
		}
		if (cur.trim()) out.push(cur.trim());
		return out;
	}

	function shadows(str) {
		if (!str || str === 'none') return [];
		const list = [];
		for (const part of splitTop(str)) {
			if (/inset/.test(part)) continue;
			const col = part.match(/rgba?\([^)]+\)/);
			const nums = part.replace(/rgba?\([^)]+\)/, '').trim().split(/\s+/).map(px);
			const c = rgba(col ? col[0] : 'rgba(0,0,0,0.2)');
			if (!c) continue;
			list.push({x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, c});
		}
		return list;
	}

	function radius(cs, w, h) {
		const r = v => (String(v).includes('%') ? Math.min(w, h) * px(v) / 100 : px(v));
		return {
			tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius),
			br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius),
		};
	}

	function border(cs) {
		const sides = ['Top', 'Right', 'Bottom', 'Left'];
		const w = sides.map(s => (/none|hidden/.test(cs['border' + s + 'Style']) ? 0 : px(cs['border' + s + 'Width'])));
		const i = w.findIndex(v => v > 0);
		if (i < 0) return null;
		const c = rgba(cs['border' + sides[i] + 'Color']);
		if (!c) return null;
		return {w, c, dash: /dashed|dotted/.test(cs['border' + sides[i] + 'Style'])};
	}

	// CSS angle of a linear-gradient: "135deg", "to right", "to top left", default 180deg. A corner depends on the
	// box: "to top right" makes the top-left and bottom-right corners the same colour.
	function gradientAngle(first, w, h) {
		const deg = first.match(/^(-?[\d.]+)(deg|turn|rad|grad)$/);
		if (deg) return deg[2] === 'turn' ? parseFloat(deg[1]) * 360 : deg[2] === 'rad' ? parseFloat(deg[1]) * 180 / Math.PI : deg[2] === 'grad' ? parseFloat(deg[1]) * 0.9 : parseFloat(deg[1]);
		if (!first.startsWith('to ')) return null;
		const k = first.slice(3).split(/\s+/).sort().join(' ');
		const c = w > 0 && h > 0 ? Math.atan2(h, w) * 180 / Math.PI : 45;
		return {'top': 0, 'right': 90, 'bottom': 180, 'left': 270, 'right top': c, 'bottom right': 180 - c, 'bottom left': 180 + c, 'left top': 360 - c}[k] ?? 180;
	}

	const STOP_COLOR = /(rgba?|hsla?)\([^)]*\)|transparent/;
	// "in oklab", "in hsl longer hue": the colour space to blend in; Figma blends in sRGB anyway
	const noSpace = s => s.replace(/\bin [a-z-]+( [a-z]+ hue)?/, '').trim();

	// colour stops -> [{c, p}], p from 0 to 1 along a gradient line `len` px long. Positions in % or px, two positions
	// ("red 0 96px": a hard-edged band), missing ones spread evenly, never going back (as CSS clamps them).
	function colorStops(parts, len) {
		let stops = [];
		for (const part of parts) {
			const col = part.match(STOP_COLOR);
			if (!col) continue; // a colour hint ("30%")
			const c = rgbaAny(col[0]);
			if (!c) continue;
			const pos = [];
			for (const t of part.replace(col[0], '').trim().split(/\s+/).filter(Boolean)) {
				if (t.endsWith('%')) pos.push(parseFloat(t) / 100);
				else if (/^-?[\d.]+(px)?$/.test(t) && len > 0) pos.push(parseFloat(t) / len);
			}
			if (!pos.length) stops.push({c, p: null});
			for (const p of pos.slice(0, 2)) stops.push({c, p});
		}
		if (stops.length < 2) return null;
		if (stops[0].p === null) stops[0].p = 0;
		if (stops[stops.length - 1].p === null) stops[stops.length - 1].p = 1;
		for (let i = 1; i < stops.length - 1; i++) {
			if (stops[i].p !== null) continue;
			let j = i;
			while (stops[j].p === null) j++;
			const a = stops[i - 1].p, b = stops[j].p, n = j - i + 1;
			for (let k = i; k < j; k++) stops[k].p = a + (b - a) * (k - i + 1) / n;
		}
		for (let i = 1; i < stops.length; i++) stops[i].p = Math.max(stops[i].p, stops[i - 1].p);
		// a fully transparent stop takes its neighbour's colour: CSS fades in premultiplied alpha, so a fade to
		// "transparent" has no grey edge. Between two different colours it becomes two stops.
		const out = [];
		stops.forEach((s, i) => {
			if (s.c[3] > 0) return out.push(s);
			const a = i > 0 && stops[i - 1].c[3] > 0 ? stops[i - 1].c : null;
			const b = i < stops.length - 1 && stops[i + 1].c[3] > 0 ? stops[i + 1].c : null;
			if (a) out.push({c: [a[0], a[1], a[2], 0], p: s.p});
			if (b && (!a || [0, 1, 2].some(k => a[k] !== b[k]))) out.push({c: [b[0], b[1], b[2], 0], p: s.p});
			if (!a && !b) out.push(s);
		});
		stops = out;
		// stops outside 0..1 (a band starting before the line, a circle larger than the ray): the colour at 0 and 1
		if (stops[0].p >= 0 && stops[stops.length - 1].p <= 1) return stops;
		const at = p => {
			if (p <= stops[0].p) return stops[0].c;
			for (let i = 1; i < stops.length; i++) {
				if (p > stops[i].p) continue;
				const a = stops[i - 1], b = stops[i], t = b.p > a.p ? (p - a.p) / (b.p - a.p) : 1;
				return a.c.map((v, k) => v + (b.c[k] - v) * t);
			}
			return stops[stops.length - 1].c;
		};
		return [{c: at(0), p: 0}, ...stops.filter(s => s.p > 0 && s.p < 1), {c: at(1), p: 1}];
	}

	// linear-gradient in a w×h box: px stops are measured along the CSS gradient line (|w·sin| + |h·cos| long)
	function parseLinearGradient(fn, w, h) {
		const inner = fn.replace(/^(repeating-)?linear-gradient\(/, '').replace(/\)$/, '');
		const parts = splitTop(inner);
		let angle = 180;
		if (!STOP_COLOR.test(parts[0])) {
			const a = gradientAngle(noSpace(parts[0]), w, h);
			if (a !== null) angle = a;
			parts.shift();
		}
		const t = angle * Math.PI / 180;
		const stops = colorStops(parts, Math.abs(w * Math.sin(t)) + Math.abs(h * Math.cos(t)));
		return stops ? {type: 'gradient', angle, stops} : null;
	}

	// radial-gradient([circle|ellipse] [size] [at x y], stops) in a w×h box -> centre and radii in px from the box's
	// top-left corner; stops along the horizontal radius
	function parseRadialGradient(fn, w, h) {
		const inner = fn.replace(/^(repeating-)?radial-gradient\(/, '').replace(/\)$/, '');
		const parts = splitTop(inner);
		const cfg = STOP_COLOR.test(parts[0]) ? '' : noSpace(parts.shift());
		const [shapeSize, at] = cfg.split(/\bat\b/).map(s => s.trim());
		const len = (v, ref) => (v.endsWith('%') ? parseFloat(v) / 100 * ref : parseFloat(v));
		const KW = {left: 0, top: 0, center: 50, right: 100, bottom: 100};
		let cx = w / 2, cy = h / 2;
		if (at) {
			let [a, b] = at.split(/\s+/);
			if (b === undefined) b = 'center';
			if (/^(top|bottom)$/.test(a) || /^(left|right)$/.test(b)) [a, b] = [b, a];
			cx = a in KW ? KW[a] / 100 * w : len(a, w);
			cy = b in KW ? KW[b] / 100 * h : len(b, h);
		}
		const words = (shapeSize || '').split(/\s+/).filter(Boolean);
		const sizes = words.filter(x => /^-?[\d.]/.test(x));
		const circle = words.includes('circle') || (!words.includes('ellipse') && sizes.length === 1);
		let rx, ry;
		if (sizes.length) {
			rx = len(sizes[0], w);
			ry = circle ? rx : len(sizes[1] || sizes[0], h);
		} else {
			const kw = words.find(x => /^(closest|farthest)-(side|corner)$/.test(x)) || 'farthest-corner';
			const pick = kw.startsWith('closest') ? Math.min : Math.max;
			const dx = pick(Math.abs(cx), Math.abs(w - cx)), dy = pick(Math.abs(cy), Math.abs(h - cy));
			if (kw.endsWith('side')) {
				rx = circle ? pick(dx, dy) : dx;
				ry = circle ? rx : dy;
			} else if (circle) {
				rx = ry = Math.hypot(dx, dy);
			} else {
				// the ellipse of the matching *-side size, grown until it passes through the corner
				rx = dx * Math.SQRT2;
				ry = dy * Math.SQRT2;
			}
		}
		if (!(rx > 0 && ry > 0)) return null;
		const stops = colorStops(parts, rx);
		return stops ? {type: 'radial', cx, cy, rx, ry, stops} : null;
	}

	// "calc(100% - 14px)", "50%", "12px" -> offset of an image of size `img` inside a box of `box`
	function bgOffset(v, box, img) {
		const pct = (v.match(/(-?[\d.]+)%/) || [0, 0])[1];
		let pxPart = 0;
		const calc = v.match(/calc\((.*)\)/);
		if (calc) {
			for (const m of calc[1].matchAll(/([+-])?\s*(-?[\d.]+)px/g)) pxPart += (m[1] === '-' ? -1 : 1) * parseFloat(m[2]);
		} else if (/px$/.test(v.trim())) pxPart = px(v);
		return (box - img) * parseFloat(pct) / 100 + pxPart;
	}

	function naturalSize(src) {
		return new Promise(resolve => {
			const im = new Image();
			im.onload = () => resolve([im.naturalWidth || 0, im.naturalHeight || 0]);
			im.onerror = () => resolve([0, 0]);
			im.src = src;
		});
	}

	// background-image layers -> frame fills (cover/contain/gradients) or positioned child images (icons)
	async function backgrounds(el, cs, b, node) {
		const bi = cs.backgroundImage;
		if (!bi || bi === 'none') return;
		const layers = splitTop(bi);
		const sizes = splitTop(cs.backgroundSize);
		const posX = splitTop(cs.backgroundPositionX);
		const posY = splitTop(cs.backgroundPositionY);
		const fills = [];
		for (let i = 0; i < layers.length; i++) {
			const layer = layers[i];
			if (/(linear|radial)-gradient\(/.test(layer)) {
				const g = /radial-gradient\(/.test(layer) ? parseRadialGradient(layer, b.w, b.h) : parseLinearGradient(layer, b.w, b.h);
				if (g) fills.push(g);
				continue;
			}
			const url = layer.match(/^url\(["']?(.*?)["']?\)$/);
			if (!url) continue;
			const src = url[1];
			const size = (sizes[i] || sizes[0] || 'auto').trim();
			if (size === 'cover' || size === 'contain' || /^100%( 100%)?$/.test(size)) {
				fills.push({type: 'image', src, fit: size === 'contain' ? 'contain' : 'cover'});
				continue;
			}
			// icon-like background: place it as its own image node
			const bl = px(cs.borderLeftWidth), bt = px(cs.borderTopWidth);
			const boxW = b.w - bl - px(cs.borderRightWidth), boxH = b.h - bt - px(cs.borderBottomWidth);
			let [nw, nh] = await naturalSize(src);
			const sz = size.split(/\s+/);
			if (sz[0] && sz[0].endsWith('px')) {
				const w = px(sz[0]);
				const h = sz[1] && sz[1].endsWith('px') ? px(sz[1]) : (nw ? nh * w / nw : w);
				nw = w;
				nh = h;
			}
			if (!nw || !nh) continue;
			const x = b.x + bl + bgOffset(posX[i] || posX[0] || '0%', boxW, nw);
			const y = b.y + bt + bgOffset(posY[i] || posY[0] || '0%', boxH, nh);
			node.ch.push({t: 'img', n: 'background', src, fit: 'fill', x, y, w: nw, h: nh, abs: true}); // decoration, not a flex item
		}
		// CSS paints the first layer on top; Figma paints the last fill on top
		if (fills.length) node.layers = fills.reverse();
	}

	// filter: blur() -> blur, backdrop-filter: blur() -> bblur, mix-blend-mode -> blend, filter: drop-shadow() -> drop
	// (added to the frame's shadows). Other filters (brightness, grayscale…) have no Figma equivalent.
	const BLEND = /^(multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity)$/;
	function effectsOf(cs) {
		const props = {}, drop = [];
		const filter = cs.filter && cs.filter !== 'none' ? cs.filter : '';
		const blur = filter.match(/blur\(([\d.]+)px\)/);
		if (blur && parseFloat(blur[1]) > 0) props.blur = parseFloat(blur[1]);
		const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || '';
		const bb = backdrop.match(/blur\(([\d.]+)px\)/);
		if (bb && parseFloat(bb[1]) > 0) props.bblur = parseFloat(bb[1]);
		if (BLEND.test(cs.mixBlendMode)) props.blend = cs.mixBlendMode;
		for (const m of filter.matchAll(/drop-shadow\(((?:[^()]|\([^()]*\))*)\)/g)) {
			const [d] = shadows(m[1]);
			if (d) drop.push(Object.assign(d, {spread: 0}));
		}
		return {props, drop};
	}

	// CSS clip-path -> an SVG path in the element's own pixels (border box), or null.
	// polygon(), inset(), circle(), ellipse() and path(); url() references and calc() are not handled.
	function clipPathOf(cs, w, h) {
		const v = cs.clipPath;
		if (!v || v === 'none' || /url\(|calc\(/.test(v)) return null;
		const len = (s, ref) => (/%$/.test(s) ? parseFloat(s) / 100 * ref : px(s));
		const n = x => Math.round(x * 100) / 100;
		let m;
		if ((m = v.match(/polygon\((.*)\)/))) {
			const pts = m[1].replace(/^\s*(nonzero|evenodd)\s*,/, '').split(',').map(p => p.trim().split(/\s+/));
			if (pts.length < 3 || pts.some(p => p.length < 2)) return null;
			return 'M' + pts.map(([x, y]) => n(len(x, w)) + ' ' + n(len(y, h))).join(' L') + ' Z';
		}
		if ((m = v.match(/inset\(([^)]*)\)/))) {
			const p = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
			const t = len(p[0], h), r = len(p[1] || p[0], w), b = len(p[2] || p[0], h), l = len(p[3] || p[1] || p[0], w);
			return 'M' + n(l) + ' ' + n(t) + ' H' + n(w - r) + ' V' + n(h - b) + ' H' + n(l) + ' Z';
		}
		const ellipse = (cx, cy, rx, ry) => 'M' + n(cx - rx) + ' ' + n(cy) + ' A' + n(rx) + ' ' + n(ry) + ' 0 1 0 ' + n(cx + rx) + ' ' + n(cy) + ' A' + n(rx) + ' ' + n(ry) + ' 0 1 0 ' + n(cx - rx) + ' ' + n(cy) + ' Z';
		const centre = at => {
			const p = (at || '50% 50%').trim().split(/\s+/);
			return [len(p[0] || '50%', w), len(p[1] || '50%', h)];
		};
		const radius = (s, ref, dists) => (!s || s === 'closest-side' ? Math.min(...dists) : s === 'farthest-side' ? Math.max(...dists) : len(s, ref));
		if ((m = v.match(/circle\(([^)]*)\)/))) {
			const [r, at] = m[1].split(/\s+at\s+|^at\s+/);
			const [cx, cy] = centre(at);
			const R = radius((r || '').trim(), Math.hypot(w, h) / Math.SQRT2, [cx, w - cx, cy, h - cy]);
			return ellipse(cx, cy, R, R);
		}
		if ((m = v.match(/ellipse\(([^)]*)\)/))) {
			const [r, at] = m[1].split(/\s+at\s+|^at\s+/);
			const [cx, cy] = centre(at);
			const rs = (r || '').trim().split(/\s+/);
			return ellipse(cx, cy, radius(rs[0], w, [cx, w - cx]), radius(rs[1] || rs[0], h, [cy, h - cy]));
		}
		if ((m = v.match(/path\(\s*(?:(?:nonzero|evenodd)\s*,\s*)?["'](.*)["']\s*\)/))) return m[1];
		return null;
	}

	// The installed font the browser really draws a generic family with (sans-serif -> Arial on Windows, Helvetica on
	// macOS), found by comparing text widths; null when no candidate matches. Figma has no generic families.
	const GENERIC_CANDIDATES = {
		'sans-serif': ['Arial', 'Helvetica', 'Segoe UI', 'Liberation Sans', 'DejaVu Sans', 'Roboto', 'Noto Sans'],
		'serif': ['Times New Roman', 'Times', 'Georgia', 'Liberation Serif', 'DejaVu Serif', 'Noto Serif'],
		'monospace': ['Courier New', 'Consolas', 'Menlo', 'Monaco', 'SF Mono', 'Liberation Mono', 'DejaVu Sans Mono'],
		'system-ui': ['Segoe UI', 'SF Pro Text', 'SF Pro', 'Helvetica Neue', 'Roboto', 'Ubuntu', 'Cantarell', 'Noto Sans', 'Arial'],
	};
	GENERIC_CANDIDATES['-apple-system'] = GENERIC_CANDIDATES['blinkmacsystemfont'] = GENERIC_CANDIDATES['ui-sans-serif'] = GENERIC_CANDIDATES['system-ui'];
	GENERIC_CANDIDATES['ui-serif'] = GENERIC_CANDIDATES['serif'];
	GENERIC_CANDIDATES['ui-monospace'] = GENERIC_CANDIDATES['monospace'];
	const GENERIC_FONT = {};
	let measureCtx = null;
	function genericFont(g) {
		const key = g.toLowerCase();
		if (!GENERIC_CANDIDATES[key]) return null;
		if (key in GENERIC_FONT) return GENERIC_FONT[key];
		measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
		const probes = ['mmmmmmmmmmlli WAVEy 0123456789', 'The quick brown fox, jumps! iIl1|'];
		const width = font => probes.map(t => {
			measureCtx.font = '72px ' + font;
			return measureCtx.measureText(t).width;
		}).join(',');
		const generic = width(key);
		let found = null;
		for (const c of GENERIC_CANDIDATES[key]) {
			// installed: the width stays the same whichever fallback stands behind it
			const withSerif = width('"' + c + '", serif');
			if (withSerif === width('"' + c + '", monospace') && withSerif === generic) {
				found = c;
				break;
			}
		}
		return (GENERIC_FONT[key] = found);
	}

	function fontInfo(cs) {
		// the whole stack: the browser picks per letter (e.g. Armenian from one font, Latin from the next), and so can the plugin
		const ffs = [];
		for (const f of cs.fontFamily.split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean)) {
			// a generic family: first the font it stands for here, so Figma gets the same letter widths
			const real = genericFont(f);
			if (real && !ffs.includes(real)) ffs.push(real);
			ffs.push(f);
		}
		const ff = ffs[0] || 'Inter';
		return {
			ff, ffs, fw: parseInt(cs.fontWeight, 10) || 400, fs: px(cs.fontSize), it: cs.fontStyle === 'italic',
			lh: cs.lineHeight === 'normal' ? null : px(cs.lineHeight),
			ls: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
			// the letters' paint: -webkit-text-fill-color when set (transparent for gradient text), else color
			c: rgbaAny(cs.webkitTextFillColor || cs.color) || [0, 0, 0, 1],
			tc: {uppercase: 'upper', lowercase: 'lower', capitalize: 'title'}[cs.textTransform] || 'none',
			td: /underline/.test(cs.textDecorationLine) ? 'underline' : /line-through/.test(cs.textDecorationLine) ? 'strike' : 'none',
		};
	}

	function box(r) {
		return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height};
	}

	// line boxes from client rects: a rect starts a new line when its middle is below the current line
	function lineGroups(rects) {
		const rs = [...rects].filter(r => r.width > 0 && r.height > 0).sort((a, c) => a.top - c.top || a.left - c.left);
		const lines = [];
		for (const r of rs) {
			const last = lines[lines.length - 1];
			if (last && r.top + r.height / 2 < last.bottom) {
				last.rects.push(r);
				last.bottom = Math.max(last.bottom, r.bottom);
				last.left = Math.min(last.left, r.left);
			} else {
				lines.push({top: r.top, bottom: r.bottom, left: r.left, rects: [r]});
			}
		}
		return lines;
	}

	function textNode(text, rects, bound, cs, lineCount) {
		const f = fontInfo(cs);
		const b = box(bound);
		const ts = shadows(cs.textShadow).map(({x, y, blur, c}) => ({x, y, blur, c}));
		const extra = ts.length ? {ts} : {};
		// vertical writing (writing-mode: vertical-rl…): one line, turned 90° clockwise by the plugin inside this box
		if (/^(vertical|sideways)/.test(cs.writingMode)) return Object.assign({t: 't', s: text, x: b.x, y: b.y, w: b.w, h: b.h, al: 'left', multi: false, vt: true}, f, extra);
		const lines = lineCount || Math.max(1, new Set([...rects].filter(r => r.width > 0).map(r => Math.round(r.top))).size);
		const contentH = rects.length ? rects[0].height : b.h;
		const y = f.lh ? b.y - (f.lh - contentH) / 2 : b.y;
		const h = f.lh ? f.lh * lines : b.h;
		const al = {start: 'left', end: 'right', justify: 'left', '-webkit-center': 'center'}[cs.textAlign] || cs.textAlign;
		// starts mid-line (after a link, an icon or a badge) and wraps: the box starts at the left edge of the later
		// lines, and the first line is indented to where it starts (Figma's paragraph indent; it applies to every
		// paragraph, so not for text with line breaks)
		if (lines > 1 && al === 'left' && !text.includes('\n')) {
			const ls = lineGroups(rects);
			const ind = ls.length > 1 ? ls[0].left - bound.left : 0;
			if (ind > 0.5) extra.ind = Math.round(ind * 100) / 100;
		}
		// every line ends at a <br> or \n, none wraps: Figma must not wrap it either (its fonts can be a bit wider)
		if (lines > 1 && text.split('\n').length === lines) extra.nw = true;
		return Object.assign({t: 't', s: text, x: b.x, y, w: b.w, h, al, multi: lines > 1}, f, extra);
	}

	// Line boxes that share a top but sit apart are CSS columns: their left edges, sorted; null for normal text.
	function columnsOf(rects) {
		const rs = [...rects].filter(r => r.width > 0);
		const shared = rs.some(a => rs.some(c => a !== c && Math.abs(a.top - c.top) < 2 && Math.abs(a.left - c.left) > 20));
		if (!shared) return null;
		const lefts = [];
		for (const r of rs) if (!lefts.some(l => Math.abs(l - r.left) < 4)) lefts.push(r.left);
		return lefts.sort((a, c) => a - c);
	}

	// Icon fonts (Font Awesome, Material Icons…): Figma rarely has them, so the glyphs become pictures. Icon text is
	// all Private Use Area characters, or set in a font named like an icon font (ligature fonts spell words).
	const ICON_FONT = /awesome|material (icons|symbols)|ionicons|feather|glyphicons|icomoon|fontello|remixicon|bootstrap-icons|lucide|tabler|boxicons|dashicons|octicons|\bicons?\b/i;
	function isIconText(s, cs) {
		const t = s.replace(/\s+/g, '');
		if (!t) return false;
		if ([...t].every(ch => {
			const cp = ch.codePointAt(0);
			return (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
		})) return true;
		const first = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
		return ICON_FONT.test(first);
	}

	// the glyphs drawn on a canvas at 4×, in their colour; the picture grows where the ink spills out of the line box
	function iconNode(text, bound, cs, el) {
		try {
			const S = 4;
			const ctx = document.createElement('canvas').getContext('2d');
			const font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
			ctx.font = font;
			if ('letterSpacing' in ctx && cs.letterSpacing !== 'normal') ctx.letterSpacing = cs.letterSpacing;
			const m = ctx.measureText(text);
			const base = (bound.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
			const left = Math.floor(Math.min(0, -m.actualBoundingBoxLeft)), right = Math.ceil(Math.max(bound.width, m.actualBoundingBoxRight));
			const top = Math.floor(Math.min(0, base - m.actualBoundingBoxAscent)), bottom = Math.ceil(Math.max(bound.height, base + m.actualBoundingBoxDescent));
			const w = right - left, h = bottom - top;
			if (!(w > 0 && h > 0) || !(m.actualBoundingBoxRight + m.actualBoundingBoxLeft > 0)) return null;
			const canvas = ctx.canvas;
			canvas.width = Math.ceil(w * S);
			canvas.height = Math.ceil(h * S);
			const g = canvas.getContext('2d');
			g.scale(S, S);
			g.font = font;
			if ('letterSpacing' in g && cs.letterSpacing !== 'normal') g.letterSpacing = cs.letterSpacing;
			g.fillStyle = cs.color;
			g.textBaseline = 'alphabetic';
			g.fillText(text, -left, base - top);
			const b = box(bound);
			// named after the nearest class (a ::before glyph sits in a span without one): "icon fa-palette"
			let name = null;
			for (let p = el, i = 0; p && !name && i < 3; p = p.parentElement, i++) {
				const cls = (typeof p.className === 'string' ? p.className : '').split(/\s+/)
					.filter(c => c && !c.startsWith('__h2f') && !/^fa-(solid|regular|brands|light|thin|duotone|sharp|fw|xs|sm|lg|[2-9]?x\d*|spin|pulse)$/.test(c));
				name = cls.find(c => /^(fa|bi|mdi|ri|ti|bx|icon)-/.test(c)) || cls.find(c => c.includes('-')) || cls[0] || null;
			}
			return {t: 'img', n: 'icon' + (name ? ' ' + name : ''), x: b.x + left, y: b.y + top, w, h, data: canvas.toDataURL('image/png').split(',')[1], fit: 'fill'};
		} catch (e) {
			return null;
		}
	}

	// [start, end) of a text node without the white space CSS collapses at its ends (all of it in pre text)
	function visibleSpan(raw, cs) {
		if (/pre/.test(cs.whiteSpace)) return [0, raw.length];
		const a = raw.search(/[^ \t\n\r\f]/);
		if (a < 0) return [0, 0];
		return [a, raw.length - raw.match(/[ \t\n\r\f]*$/)[0].length];
	}

	// One DOM text node -> text layers: usually one; one per column when the text flows over CSS columns.
	function textNodes(child, cs) {
		const raw = child.nodeValue;
		const clean = s => replaceText(/pre/.test(cs.whiteSpace) ? s : s.replace(/\s+/g, ' ').trim());
		const range = document.createRange();
		range.selectNodeContents(child);
		const bound = range.getBoundingClientRect();
		if (bound.width === 0 || bound.height === 0) return [];
		if (isIconText(raw, cs)) {
			// measured without the spaces around the glyphs
			const lead = raw.length - raw.trimStart().length;
			range.setStart(child, lead);
			range.setEnd(child, lead + raw.trim().length);
			const icon = iconNode(raw.trim(), range.getBoundingClientRect(), cs, child.parentElement);
			if (icon) return [icon];
			range.selectNodeContents(child);
		}
		const rects = range.getClientRects();
		const cols = columnsOf(rects);
		if (!cols) {
			// measured from the first to the last letter: a space kept between an icon and " Word" is not in the
			// text, so the box starts where the word does
			const [a, z] = visibleSpan(raw, cs);
			if (z > a && (a > 0 || z < raw.length)) {
				range.setStart(child, a);
				range.setEnd(child, z);
				const b = range.getBoundingClientRect();
				if (b.width > 0 && b.height > 0) return [textNode(clean(raw), range.getClientRects(), b, cs)];
			}
			return [textNode(clean(raw), rects, bound, cs)];
		}
		// which column each character sits in; the text of a column is one stretch of the string
		const colAt = [];
		let cur = 0;
		for (let i = 0; i < raw.length; i++) {
			range.setStart(child, i);
			range.setEnd(child, i + 1);
			const r = range.getBoundingClientRect();
			if (r.width > 0) {
				cur = 0;
				for (let k = 0; k < cols.length; k++) if (r.left >= cols[k] - 2) cur = k;
			}
			colAt.push(cur);
		}
		const out = [];
		for (let start = 0; start < raw.length;) {
			let end = start;
			while (end < raw.length && colAt[end] === colAt[start]) end++;
			const s = clean(raw.slice(start, end));
			if (s) {
				range.setStart(child, start);
				range.setEnd(child, end);
				const b = range.getBoundingClientRect();
				if (b.width > 0 && b.height > 0) out.push(textNode(s, range.getClientRects(), b, cs));
			}
			start = end;
		}
		return out;
	}

	// ---- mixed inline text ----------------------------------------------------------------------------
	// Words with links, bold or coloured words among them (<p>Read the <a>guide</a> first.</p>) become ONE text layer
	// with styled ranges. Measured piece by piece, a piece that starts mid-line and wraps would start at the
	// paragraph's left edge in Figma, on top of the words before it.

	// an inline element that only changes how its words look: no box of its own, no icon, only such content inside
	function isFlowElement(el) {
		if (el.tagName === 'BR') return true;
		if (SKIP_TAGS.test(el.tagName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return false;
		if (/^(img|input|select|textarea|button)$/i.test(el.tagName) || SHOT_TAGS.test(el.tagName.toLowerCase())) return false;
		const cs = getComputedStyle(el);
		if (cs.display !== 'inline' || cs.visibility !== 'visible' || parseFloat(cs.opacity) < 1) return false;
		if (rgba(cs.backgroundColor) || border(cs) || shadows(cs.boxShadow).length || (cs.backgroundImage && cs.backgroundImage !== 'none')) return false;
		const fx = effectsOf(cs);
		if (Object.keys(fx.props).length || fx.drop.length || (cs.clipPath && cs.clipPath !== 'none') || cs.textShadow !== 'none') return false;
		if (cs.verticalAlign !== 'baseline' || /pre/.test(cs.whiteSpace)) return false;
		const still = p => cs[p] === 'auto' || parseFloat(cs[p]) === 0;
		if (cs.position !== 'static' && !(cs.position === 'relative' && ['top', 'right', 'bottom', 'left'].every(still))) return false;
		return [...el.childNodes].every(isFlowNode);
	}

	function isFlowNode(n) {
		if (n.nodeType === Node.TEXT_NODE) return !isIconText(n.nodeValue, getComputedStyle(n.parentElement));
		if (n.nodeType === Node.COMMENT_NODE) return true;
		return n.nodeType === Node.ELEMENT_NODE && isFlowElement(n);
	}

	// text pieces and line breaks in order; td: the decoration drawn over it (a link's underline reaches its <b>)
	function flowPieces(nodes, out, td) {
		for (const n of nodes) {
			if (n.nodeType === Node.TEXT_NODE) {
				out.push({node: n, cs: getComputedStyle(n.parentElement), td});
			} else if (n.nodeType === Node.ELEMENT_NODE) {
				if (n.tagName === 'BR') {
					out.push({br: true});
					continue;
				}
				const own = fontInfo(getComputedStyle(n)).td;
				flowPieces(n.childNodes, out, own !== 'none' ? own : td);
			}
		}
		return out;
	}

	const SPACE = /[ \t\n\r\f]/;
	const STYLE_KEYS = ['ff', 'ffs', 'fw', 'it', 'fs', 'c', 'td', 'tc', 'ls'];

	// consecutive flow nodes -> text layers (one, or several when the text flows over CSS columns)
	function flowText(nodes) {
		const pieces = flowPieces(nodes, [], null);
		const texts = pieces.filter(p => p.node && p.node.nodeValue.trim());
		if (!texts.length) return [];
		if (texts.length === 1 && !pieces.some(p => p.br)) {
			const out = textNodes(texts[0].node, texts[0].cs);
			if (texts[0].td && texts[0].td !== 'none') for (const n of out) if (n.t === 't' && n.td === 'none') n.td = texts[0].td;
			return out;
		}
		// the merged string, white space collapsed across the pieces, and the piece of each character (UTF-16 units)
		let s = '';
		const from = [];
		pieces.forEach((p, i) => {
			if (p.br) {
				while (s.endsWith(' ')) {
					s = s.slice(0, -1);
					from.pop();
				}
				s += '\n';
				from.push(from.length ? from[from.length - 1] : i);
				return;
			}
			for (const ch of replaceText(p.node.nodeValue)) {
				if (SPACE.test(ch)) {
					if (!s || s.endsWith(' ') || s.endsWith('\n')) continue;
					s += ' ';
					from.push(i);
				} else {
					s += ch;
					for (let k = 0; k < ch.length; k++) from.push(i);
				}
			}
		});
		while (s.endsWith(' ') || s.endsWith('\n')) {
			s = s.slice(0, -1);
			from.pop();
		}
		// a <br> first: its piece is the next text's
		for (let k = from.length - 1; k >= 0; k--) if (pieces[from[k]].br && k + 1 < from.length) from[k] = from[k + 1];
		const range = document.createRange();
		const rects = [];
		texts.forEach((p, k) => {
			range.selectNodeContents(p.node);
			// spaces at the very start and end are not in the text, so not in the box either
			const [a, z] = visibleSpan(p.node.nodeValue, p.cs);
			if (k === 0) range.setStart(p.node, a);
			if (k === texts.length - 1) range.setEnd(p.node, z);
			rects.push(...[...range.getClientRects()].filter(r => r.width > 0 && r.height > 0));
		});
		if (!rects.length) return [];
		const lines = lineGroups(rects);
		const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
		const bound = new DOMRect(left, top, Math.max(...rects.map(r => r.right)) - left, Math.max(...rects.map(r => r.bottom)) - top);
		const base = texts[0];
		const node = textNode(s, rects, bound, base.cs, lines.length);
		const styleOf = p => {
			const f = fontInfo(p.cs);
			if (f.td === 'none' && p.td) f.td = p.td;
			return f;
		};
		if (base.td && node.td === 'none') node.td = base.td;
		// ranges whose style differs from the layer's
		const baseKey = JSON.stringify(STYLE_KEYS.map(k => node[k]));
		const runs = [];
		for (let k = 0; k < from.length;) {
			let e = k + 1;
			while (e < from.length && from[e] === from[k]) e++;
			const st = styleOf(pieces[from[k]]);
			const key = JSON.stringify(STYLE_KEYS.map(x => st[x]));
			const prev = runs[runs.length - 1];
			if (key !== baseKey) {
				if (prev && prev.e === k && prev.key === key) prev.e = e;
				else runs.push(Object.assign({s: k, e, key}, ...STYLE_KEYS.map(x => ({[x]: st[x]}))));
			}
			k = e;
		}
		if (runs.length) node.runs = runs.map(r => {
			delete r.key;
			return r;
		});
		return [node];
	}

	// The element a <use> points to: "#id" in this page, or "sprite.svg#id" (same site, fetched once).
	const SPRITES = {};
	async function useTarget(href) {
		if (!href) return null;
		if (href.startsWith('#')) return document.getElementById(href.slice(1));
		try {
			const u = new URL(href, location.href);
			const file = u.href.split('#')[0];
			if (!SPRITES[file]) SPRITES[file] = fetch(file).then(r => r.text()).then(t => new DOMParser().parseFromString(t, 'image/svg+xml')).catch(() => null);
			const doc = await SPRITES[file];
			return doc && u.hash ? doc.getElementById(u.hash.slice(1)) : null;
		} catch (e) {
			return null;
		}
	}

	// <use> -> a <g> with a copy of what it points to (a copied <use> would point at nothing in Figma).
	// A <symbol> is fitted into the use's box (its viewBox, centred, like preserveAspectRatio's default).
	async function inlineUses(clone, w, h) {
		const NS = 'http://www.w3.org/2000/svg';
		const vbOuter = (clone.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
		const vw = vbOuter.length === 4 && vbOuter[2] > 0 ? vbOuter[2] : w, vh = vbOuter.length === 4 && vbOuter[3] > 0 ? vbOuter[3] : h;
		const size = (v, ref) => (!v ? ref : /%$/.test(v) ? parseFloat(v) / 100 * ref : parseFloat(v) || ref);
		for (const use of [...clone.querySelectorAll('use')]) {
			const target = await useTarget(use.getAttribute('href') || use.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
			if (!target) continue;
			const g = document.createElementNS(NS, 'g');
			for (const a of ['fill', 'stroke', 'stroke-width', 'opacity']) if (use.hasAttribute(a)) g.setAttribute(a, use.getAttribute(a));
			const x = parseFloat(use.getAttribute('x')) || 0, y = parseFloat(use.getAttribute('y')) || 0;
			let tr = (use.getAttribute('transform') ? use.getAttribute('transform') + ' ' : '') + 'translate(' + x + ' ' + y + ')';
			if (target.tagName.toLowerCase() === 'symbol') {
				const vb = (target.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
				const W = size(use.getAttribute('width'), vw), H = size(use.getAttribute('height'), vh);
				if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
					const s = Math.min(W / vb[2], H / vb[3]);
					tr += ' translate(' + (W - vb[2] * s) / 2 + ' ' + (H - vb[3] * s) / 2 + ') scale(' + s + ') translate(' + -vb[0] + ' ' + -vb[1] + ')';
				}
				for (const c of target.childNodes) g.appendChild(document.importNode(c, true));
			} else {
				const copy = document.importNode(target, true);
				copy.removeAttribute('id');
				g.appendChild(copy);
			}
			g.setAttribute('transform', tr);
			use.replaceWith(g);
		}
	}

	// Dashed strokes drawn with an offset, a pathLength or at another scale (donut charts, progress rings): Figma's
	// SVG import has no dash offset and keeps the dash lengths unscaled, so a slice would repeat round the ring.
	// Each dash becomes a path of its own, measured on the live element; null: leave the stroke as it is.
	const DASH_MAX = 300;
	// a circle or ellipse as SVG draws it: from (cx + rx, cy), clockwise; angle(s) = the angle s along the outline
	function roundShape(el) {
		const tag = el.tagName.toLowerCase();
		const v = name => (el[name] && el[name].animVal ? el[name].animVal.value : NaN);
		if (tag === 'circle') {
			const r = v('r');
			return r > 0 ? {cx: v('cx'), cy: v('cy'), rx: r, ry: r, L: 2 * Math.PI * r, angle: s => s / r} : null;
		}
		if (tag !== 'ellipse') return null;
		const rx = v('rx'), ry = v('ry');
		if (!(rx > 0 && ry > 0)) return null;
		// arc length along the ellipse, in small steps
		const N = 1440, len = [0];
		for (let i = 1; i <= N; i++) {
			const t0 = 2 * Math.PI * (i - 1) / N, t1 = 2 * Math.PI * i / N;
			len.push(len[i - 1] + Math.hypot(rx * (Math.cos(t1) - Math.cos(t0)), ry * (Math.sin(t1) - Math.sin(t0))));
		}
		const angle = s => {
			let lo = 0, hi = N;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (len[mid] <= s) lo = mid; else hi = mid;
			}
			const f = len[hi] > len[lo] ? (s - len[lo]) / (len[hi] - len[lo]) : 0;
			return 2 * Math.PI * (lo + Math.min(1, Math.max(0, f))) / N;
		};
		return {cx: v('cx'), cy: v('cy'), rx, ry, L: len[N], angle};
	}
	function dashPaths(el, cs) {
		if (!el.getTotalLength || !cs.strokeDasharray || cs.strokeDasharray === 'none' || /%/.test(cs.strokeDasharray)) return null;
		let dash = cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
		if (!dash.length || dash.some(v => v < 0) || dash.every(v => v === 0)) return null;
		const offset = parseFloat(cs.strokeDashoffset) || 0;
		const pl = parseFloat(el.getAttribute('pathLength'));
		const m = el.getCTM && el.getCTM();
		const scaled = m && Math.abs(Math.hypot(m.a, m.b) - 1) > 1e-3;
		if (!offset && !(pl > 0) && !scaled) return null;
		// circles and ellipses are measured exactly: Chrome's getTotalLength() on a circle is about 0.65% short (it
		// measures a curve approximation), while the dashes are drawn on the true circle
		const shape = roundShape(el);
		let L;
		try {
			L = shape ? shape.L : el.getTotalLength();
		} catch (e) {
			return null;
		}
		if (!(L > 0)) return null;
		const k = pl > 0 ? L / pl : 1;
		if (dash.length % 2) dash = dash.concat(dash); // an odd list repeats (SVG)
		dash = dash.map(v => v * k);
		const period = dash.reduce((a, b) => a + b, 0);
		if (L / period > DASH_MAX) return null;
		// the offset moves the pattern back along the path; no wrap-around at the end of a closed shape
		let pos = -((offset * k) % period);
		if (pos > 0) pos -= period;
		const round = cs.strokeLinecap !== 'butt';
		const spans = [];
		for (let i = 0; pos < L; i = (i + 1) % dash.length) {
			if (i % 2 === 0) {
				const a = Math.max(0, pos), b = Math.min(L, pos + dash[i]);
				if (b - a > L * 1e-4 || (round && b > a)) spans.push([a, b]); // shorter with a butt cap: not visible
				else if (round && dash[i] === 0 && pos >= 0) spans.push([pos, Math.min(L, pos + 0.01)]); // a dot
			}
			pos += dash[i];
		}
		const r3 = v => +v.toFixed(3);
		if (shape) {
			// true arcs: from the angle at a to the angle at b, clockwise (as the shape is drawn), in two halves when long
			const P = t => r3(shape.cx + shape.rx * Math.cos(t)) + ' ' + r3(shape.cy + shape.ry * Math.sin(t));
			const arc = (t0, t1) => 'A' + r3(shape.rx) + ' ' + r3(shape.ry) + ' 0 ' + (t1 - t0 > Math.PI ? 1 : 0) + ' 1 ' + P(t1);
			return spans.map(([a, b]) => {
				const t0 = shape.angle(a), t1 = shape.angle(b);
				return 'M' + P(t0) + (t1 - t0 > Math.PI ? arc(t0, (t0 + t1) / 2) + arc((t0 + t1) / 2, t1) : arc(t0, t1));
			});
		}
		const step = L / 720;
		return spans.map(([a, b]) => {
			const n = Math.max(1, Math.ceil((b - a) / step));
			const pts = [];
			for (let j = 0; j <= n; j++) {
				const p = el.getPointAtLength(a + (b - a) * j / n);
				pts.push(+p.x.toFixed(3) + ' ' + +p.y.toFixed(3));
			}
			return 'M' + pts.join('L');
		});
	}

	async function svgMarkup(liveSvg, w, h) {
		const clone = liveSvg.cloneNode(true);
		const liveAll = [liveSvg, ...liveSvg.querySelectorAll('*')];
		const cloneAll = [clone, ...clone.querySelectorAll('*')];
		liveAll.forEach((el, i) => {
			const c = cloneAll[i];
			if (!/^(path|circle|rect|line|polyline|polygon|ellipse|g|svg|text|tspan|use)$/i.test(el.tagName)) return;
			const cs = getComputedStyle(el);
			if (cs.fill) c.setAttribute('fill', cs.fill.startsWith('url(') ? (c.getAttribute('fill') || cs.fill) : cs.fill);
			if (cs.stroke) c.setAttribute('stroke', cs.stroke.startsWith('url(') ? (c.getAttribute('stroke') || cs.stroke) : cs.stroke);
			if (cs.strokeWidth) c.setAttribute('stroke-width', px(cs.strokeWidth));
			if (cs.opacity && cs.opacity !== '1') c.setAttribute('opacity', cs.opacity);
			if (/^(svg|g)$/i.test(el.tagName) && cs.display === 'none') c.setAttribute('display', 'none');
			c.removeAttribute('class');
			c.removeAttribute('style');
			const dashes = /^(path|circle|ellipse|rect|line|polyline|polygon)$/i.test(el.tagName) && cs.stroke !== 'none' ? dashPaths(el, cs) : null;
			if (dashes) {
				const NS = 'http://www.w3.org/2000/svg';
				const g = document.createElementNS(NS, 'g');
				if (c.getAttribute('transform')) g.setAttribute('transform', c.getAttribute('transform'));
				if (c.getAttribute('opacity')) g.setAttribute('opacity', c.getAttribute('opacity'));
				// a filled shape keeps its fill, without the stroke
				if (cs.fill && cs.fill !== 'none') {
					c.setAttribute('stroke', 'none');
					c.removeAttribute('transform');
					c.removeAttribute('opacity');
					g.appendChild(c.cloneNode(true));
				}
				for (const d of dashes) {
					const p = document.createElementNS(NS, 'path');
					if (dashes.length === 1 && !g.childNodes.length) for (const a of ['transform', 'opacity']) if (g.getAttribute(a)) p.setAttribute(a, g.getAttribute(a));
					p.setAttribute('d', d);
					p.setAttribute('fill', 'none');
					p.setAttribute('stroke', c.getAttribute('stroke'));
					p.setAttribute('stroke-width', c.getAttribute('stroke-width'));
					p.setAttribute('stroke-linecap', cs.strokeLinecap);
					p.setAttribute('stroke-linejoin', cs.strokeLinejoin);
					g.appendChild(p);
				}
				// one dash on an unfilled shape: just the path
				if (g.childNodes.length === 1 && !(cs.fill && cs.fill !== 'none')) c.replaceWith(g.firstChild);
				else if (g.childNodes.length) c.replaceWith(g);
				else c.remove(); // every dash too short to see
			}
		});
		await inlineUses(clone, w, h);
		clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		clone.setAttribute('width', w);
		clone.setAttribute('height', h);
		if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
		return replaceText(clone.outerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/currentColor/g, getComputedStyle(liveSvg).color));
	}

	// The text of an element's list marker: "•", "1.", "b.", "iv.", "▼"… ('' for none / images)
	function markerText(el, type) {
		const named = {'disc': '•', 'circle': '◦', 'square': '▪', 'disclosure-open': '▼', 'disclosure-closed': '▶'};
		if (named[type]) return named[type];
		const q = type.match(/^"(.*)"$/);
		if (q) return q[1];
		// position in the list: <ol start reversed>, <li value>
		const list = el.parentElement;
		const items = list ? [...list.children].filter(c => getComputedStyle(c).display === 'list-item') : [el];
		const idx = items.indexOf(el);
		let n;
		if (el.hasAttribute('value')) n = parseInt(el.getAttribute('value'), 10);
		else if (list && list.tagName === 'OL' && list.reversed) n = (list.hasAttribute('start') ? list.start : items.length) - idx;
		else n = (list && list.tagName === 'OL' && list.hasAttribute('start') ? list.start : 1) + idx;
		const alpha = k => { let s = ''; for (; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + (k - 1) % 26) + s; return s; };
		const roman = k => [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']].reduce((s, [v, r]) => { while (k >= v) { s += r; k -= v; } return s; }, '');
		const f = {
			'decimal': String(n), 'decimal-leading-zero': (n < 10 ? '0' : '') + n,
			'lower-alpha': alpha(n), 'lower-latin': alpha(n), 'upper-alpha': alpha(n).toUpperCase(), 'upper-latin': alpha(n).toUpperCase(),
			'lower-roman': roman(n), 'upper-roman': roman(n).toUpperCase(),
		}[type];
		return f !== undefined ? f + '.' : String(n) + '.';
	}

	// ::marker -> a real span (it cannot be measured either). Outside markers sit to the left of the content,
	// right-aligned like the browser's; inside markers (e.g. <summary>) start the line.
	function materialiseMarkers(root) {
		for (const el of [...root.querySelectorAll('*')]) {
			if (el.closest('svg') || in3d(el)) continue;
			const cs = getComputedStyle(el);
			if (cs.display !== 'list-item' || cs.listStyleType === 'none' || cs.listStyleImage !== 'none') continue;
			const text = markerText(el, cs.listStyleType);
			if (!text) continue;
			const ms = getComputedStyle(el, '::marker');
			const span = document.createElement('span');
			span.className = '__h2f-marker';
			span.style.color = ms.color;
			span.style.fontFamily = ms.fontFamily;
			span.style.fontWeight = ms.fontWeight;
			span.style.fontSize = ms.fontSize;
			if (cs.listStylePosition === 'inside') {
				span.textContent = text + ' ';
				span.style.marginRight = '0.25em';
			} else {
				span.textContent = text;
				Object.assign(span.style, {position: 'absolute', display: 'inline-block', width: '3em', marginLeft: '-3.5em', textAlign: 'right', whiteSpace: 'nowrap'});
			}
			el.insertBefore(span, el.firstChild);
			el.classList.add('__h2f-m');
		}
	}

	// ::before / ::after -> real spans, so they can be measured like anything else
	// ---- CSS 3D --------------------------------------------------------------------------------------
	// Figma has no perspective: a 3D scene (preserve-3d, perspective, rotateX/Y) cannot be rebuilt from flat layers.
	// Its outermost element becomes ONE picture: capture.js photographs just that element and what is inside it, on
	// a transparent background (`iso`). Found before the pseudo-elements are turned into spans, so the scene keeps
	// its real ::before/::after (back faces…).
	let ROOTS_3D = new Set();
	const tiny = v => Math.abs(v) < 1e-6;
	function find3dRoots(root) {
		const roots = new Set();
		for (const el of root.querySelectorAll('*')) {
			if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
			const cs = getComputedStyle(el);
			if (!cs.transform || cs.transform === 'none') continue;
			let m;
			try {
				m = new DOMMatrix(cs.transform);
			} catch (e) {
				continue;
			}
			const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
			const preserve = parent && parent.transformStyle === 'preserve-3d';
			const persp = parent && parent.perspective && parent.perspective !== 'none';
			// projective (perspective() in the transform); turned out of the screen plane inside a 3D scene; moved in
			// depth or turned under a parent's perspective
			const projective = !tiny(m.m14) || !tiny(m.m24) || !tiny(m.m44 - 1);
			const turned = !tiny(m.m13) || !tiny(m.m23) || !tiny(m.m31) || !tiny(m.m32);
			if (!(projective || (turned && preserve) || ((turned || !tiny(m.m43)) && persp))) continue;
			// the scene starts where the preserve-3d chain does
			let r = el;
			while (r.parentElement && r.parentElement !== document.body && getComputedStyle(r.parentElement).transformStyle === 'preserve-3d') r = r.parentElement;
			roots.add(r);
		}
		// only the outermost
		for (const r of [...roots]) {
			for (let p = r.parentElement; p; p = p.parentElement) if (roots.has(p)) { roots.delete(r); break; }
		}
		return roots;
	}
	function in3d(el) {
		for (let p = el; p; p = p.parentElement) if (ROOTS_3D.has(p)) return true;
		return false;
	}

	// the picture's box: the scene and everything in it as drawn (bounding rects are already projected), plus room
	// for shadows, within the page
	function scene3d(el, out) {
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pad = 0;
		for (const e of [el, ...el.querySelectorAll('*')]) {
			const r = e.getBoundingClientRect();
			if (r.width <= 0 && r.height <= 0) continue;
			x0 = Math.min(x0, r.left);
			y0 = Math.min(y0, r.top);
			x1 = Math.max(x1, r.right);
			y1 = Math.max(y1, r.bottom);
			const cs = getComputedStyle(e);
			for (const s of shadows(cs.boxShadow)) pad = Math.max(pad, Math.abs(s.x) + s.blur + s.spread, Math.abs(s.y) + s.blur + s.spread);
			const blur = (cs.filter || '').match(/blur\(([\d.]+)px\)/);
			if (blur) pad = Math.max(pad, parseFloat(blur[1]) * 3);
		}
		if (!(x1 > x0 && y1 > y0)) return;
		pad = Math.min(Math.ceil(pad), 200);
		const W = document.documentElement.scrollWidth, H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
		const x = Math.max(0, Math.floor(x0 + scrollX - pad)), y = Math.max(0, Math.floor(y0 + scrollY - pad));
		const w = Math.min(W, Math.ceil(x1 + scrollX + pad)) - x, h = Math.min(H, Math.ceil(y1 + scrollY + pad)) - y;
		if (w <= 0 || h <= 0) return;
		const id = String(++SHOTS);
		el.setAttribute('data-h2f-iso', id);
		const tag = el.tagName.toLowerCase();
		const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(c => c && !c.startsWith('__h2f'))[0];
		out.push(own(el, {t: 'img', n: '3d ' + tag + (cls ? '.' + cls : ''), iso: id, fit: 'fill', x, y, w, h, abs: true}));
	}

	function materialisePseudo(root) {
		const st = document.createElement('style');
		st.textContent = '.__h2f-b::before{content:none!important}.__h2f-a::after{content:none!important}.__h2f-m{list-style-type:none!important}';
		document.head.appendChild(st);
		for (const el of [...root.querySelectorAll('*')]) {
			if (el.closest('svg') || in3d(el)) continue;
			for (const which of ['before', 'after']) {
				const cs = getComputedStyle(el, '::' + which);
				if (!cs.content || cs.content === 'none' || cs.content === 'normal') continue;
				const span = document.createElement('span');
				for (let i = 0; i < cs.length; i++) span.style.setProperty(cs[i], cs.getPropertyValue(cs[i]));
				const m = cs.content.match(/^"(.*)"$/s);
				span.textContent = m ? m[1].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hx) => String.fromCodePoint(parseInt(hx, 16))) : '';
				if (which === 'before') el.insertBefore(span, el.firstChild); else el.appendChild(span);
				el.classList.add('__h2f-' + which[0]);
			}
		}
	}

	function controlContent(el, cs, b, node) {
		const tag = el.tagName.toLowerCase();
		if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
			if (cs.appearance === 'none' || cs.webkitAppearance === 'none') return; // custom-styled: its box is already captured
			const accent = rgba(cs.accentColor) || [0.12, 0.15, 0.91, 1];
			node.bg = el.checked ? accent : [1, 1, 1, 1];
			node.bd = el.checked ? null : {w: [1.5, 1.5, 1.5, 1.5], c: [0.6, 0.62, 0.68, 1], dash: false};
			const rr = el.type === 'radio' ? b.w / 2 : 4;
			node.br = {tl: rr, tr: rr, br: rr, bl: rr};
			if (el.checked) {
				const mark = el.type === 'radio'
					? '<svg xmlns="http://www.w3.org/2000/svg" width="' + b.w + '" height="' + b.h + '" viewBox="0 0 20 20"><circle cx="10" cy="10" r="4" fill="#fff"/></svg>'
					: '<svg xmlns="http://www.w3.org/2000/svg" width="' + b.w + '" height="' + b.h + '" viewBox="0 0 20 20" fill="none"><path d="M5 10.5l3.2 3.2L15 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
				node.ch.push(Object.assign({t: 'svg', n: 'check', svg: mark}, b));
			}
			return;
		}
		let text = '', placeholder = false;
		if (tag === 'select') text = el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
		else if (el.type === 'password' && el.value) text = '•'.repeat(el.value.length);
		else if (el.value) text = el.value;
		else if (el.placeholder) {
			text = el.placeholder;
			placeholder = true;
		}
		if (!text) return;
		const pl = px(cs.paddingLeft) + px(cs.borderLeftWidth), pr = px(cs.paddingRight) + px(cs.borderRightWidth);
		const pt = px(cs.paddingTop) + px(cs.borderTopWidth);
		const f = fontInfo(cs);
		if (placeholder) f.c = rgba(getComputedStyle(el, '::placeholder').color) || [0.54, 0.56, 0.64, 1];
		const lh = f.lh || f.fs * 1.3;
		const multi = tag === 'textarea';
		const al = {center: 'center', right: 'right', end: 'right'}[cs.textAlign] || 'left';
		// text-indent (room for a search icon drawn over the field): one line moves right, a textarea's first line indents
		const indent = al === 'left' ? Math.max(0, px(cs.textIndent)) : 0;
		const t = Object.assign({}, f, {
			t: 't', s: replaceText(text), x: b.x + pl + (multi ? 0 : indent), y: multi ? b.y + pt : b.y + (b.h - lh) / 2,
			w: Math.max(1, b.w - pl - pr - (multi ? 0 : indent)), h: multi ? b.h - pt * 2 : lh, lh, al, multi, fixed: true,
		});
		if (multi && indent > 0.5) t.ind = Math.round(indent * 100) / 100;
		node.ch.push(t);
	}

	// 2D matrices as [a, b, c, d, e, f] (CSS matrix() order): x' = a·x + c·y + e, y' = b·x + d·y + f
	function mul(m, n) {
		return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
	}

	function angle(v) {
		const m = String(v).match(/(-?[\d.]+)(deg|rad|turn|grad)/);
		if (!m) return 0;
		const x = parseFloat(m[1]);
		return {deg: x, rad: x * 180 / Math.PI, turn: x * 360, grad: x * 0.9}[m[2]] * Math.PI / 180;
	}

	// The element's own 2D transform (translate, rotate and scale properties, then transform), around its
	// transform-origin; null when there is none. {a, b, c, d, e, f, ox, oy}, origin relative to the border box.
	function transformOf(cs) {
		let m = [1, 0, 0, 1, 0, 0];
		if (cs.translate && cs.translate !== 'none') {
			const t = cs.translate.split(/\s+/).map(px);
			m = mul(m, [1, 0, 0, 1, t[0] || 0, t[1] || 0]);
		}
		if (cs.rotate && cs.rotate !== 'none' && !/^[xy]\s/.test(cs.rotate)) {
			const r = angle(cs.rotate);
			m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
		}
		if (cs.scale && cs.scale !== 'none') {
			const s = cs.scale.split(/\s+/).map(Number);
			m = mul(m, [s[0], 0, 0, s.length > 1 ? s[1] : s[0], 0, 0]);
		}
		if (cs.transform && cs.transform !== 'none') {
			const v = (cs.transform.match(/\(([^)]+)\)/) || [0, ''])[1].split(',').map(Number);
			m = mul(m, /^matrix3d/.test(cs.transform) ? [v[0], v[1], v[4], v[5], v[12], v[13]] : v.slice(0, 6));
		}
		if (m.some(v => !Number.isFinite(v)) || (Math.abs(m[0] - 1) < 1e-6 && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && Math.abs(m[3] - 1) < 1e-6 && Math.abs(m[4]) < 0.01 && Math.abs(m[5]) < 0.01)) return null;
		const o = cs.transformOrigin.split(/\s+/).map(px);
		return {a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5], ox: o[0] || 0, oy: o[1] || 0};
	}

	// which element made which node (so a transform lands on the element's own node, never on a child's)
	const OWNER = new WeakMap();
	function own(el, node) {
		OWNER.set(node, el);
		return node;
	}

	// Paint order (CSS stacking): each node gets a key [layer, z] for sorting among its siblings, since Figma paints
	// children in list order (last = top). Layers as in CSS: -1 negative z-index, 0 normal flow, 1 positioned (or a
	// stacking context) with z-index auto/0, 2 positive z-index. Nodes without a key (text) are [0, 0].
	const KEY = new WeakMap();
	const keyOf = node => KEY.get(node) || [0, 0];
	const cmpKey = (a, b) => a[0] - b[0] || a[1] - b[1];

	// [layer, z, stacking context?] from the element's own style
	function stackingOf(el, cs, tf) {
		const positioned = cs.position !== 'static';
		const parent = el.parentElement && getComputedStyle(el.parentElement).display;
		// z-index works on positioned elements and on flex and grid items
		const zApplies = cs.zIndex !== 'auto' && (positioned || /(flex|grid)$/.test(parent || ''));
		const z = zApplies ? parseInt(cs.zIndex, 10) || 0 : 0;
		const context = zApplies || /^(fixed|sticky)$/.test(cs.position) || !!tf || parseFloat(cs.opacity) < 1
			|| (cs.filter && cs.filter !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none')
			|| (cs.mixBlendMode && cs.mixBlendMode !== 'normal') || cs.isolation === 'isolate'
			|| (cs.clipPath && cs.clipPath !== 'none') || (cs.maskImage && cs.maskImage !== 'none')
			|| /paint|layout|strict|content/.test(cs.contain || '');
		const layer = z < 0 ? -1 : z > 0 ? 2 : positioned || context ? 1 : 0;
		return [layer, z, context];
	}

	// what a node paints: its box plus children that spill out of it (unless it clips), e.g. a drawer below a topbar
	const EXT = new WeakMap();
	function extent(n) {
		let e = EXT.get(n);
		if (e) return e;
		e = {x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h};
		if (!n.clip && n.ch) for (const c of n.ch) {
			const ce = extent(c);
			e = {x0: Math.min(e.x0, ce.x0), y0: Math.min(e.y0, ce.y0), x1: Math.max(e.x1, ce.x1), y1: Math.max(e.y1, ce.y1)};
		}
		EXT.set(n, e);
		return e;
	}
	const overlap = (a, b, t = 0.5) => a.x0 < b.x1 - t && b.x0 < a.x1 - t && a.y0 < b.y1 - t && b.y0 < a.y1 - t;
	// moving a layer out of its parent takes a real overlap, not line boxes touching by a pixel
	const HOIST_MIN = 3;

	// Puts a child list into paint order, moving a node only above the siblings it overlaps (where the order
	// shows); everything else keeps DOM order, so Figma's layer list still reads like the page. An Auto Layout
	// container whose in-flow items had to move loses `lay` (Figma lays items out in list order).
	// Raised parts: a node without a stacking context of its own (a plain <header>, a position: relative card) paints
	// its body at its own layer, but its positioned descendants paint in the parent's context, at theirs (a fixed
	// drawer inside the header, a z-index button on a cover). RAISED: node -> [{n, key, parent, clip}] for such
	// descendants above the node's own key; `parent` is the frame holding n, `clip` the clipping boxes between.
	const RAISED = new WeakMap();
	const partsOf = n => RAISED.get(n) || [];
	const boxExt = n => ({x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h});
	function isect(a, b) {
		if (!a) return b;
		const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
		return {x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y)};
	}
	function raisedParts(mine, own) {
		const parts = [];
		for (const c of mine.ch || []) {
			if (cmpKey(keyOf(c), own) > 0) parts.push({n: c, key: keyOf(c), parent: mine, clip: null});
			for (const p of partsOf(c)) {
				if (cmpKey(p.key, own) > 0) parts.push(Object.assign({}, p, {clip: c.clip ? isect(p.clip, {x: c.x, y: c.y, w: c.w, h: c.h}) : p.clip}));
			}
		}
		return parts;
	}
	// a node's key where it meets the area e: its own, or a raised part's that reaches into e
	function keyAgainst(n, e) {
		let k = keyOf(n);
		for (const p of partsOf(n)) if (cmpKey(p.key, k) > 0 && overlap(extent(p.n), e)) k = p.key;
		return k;
	}
	// a over b: higher key, or the same key and later in the DOM
	const over = (ka, ia, kb, ib) => cmpKey(ka, kb) > 0 || (!cmpKey(ka, kb) && ia > ib);

	// A node whose body paints under a sibling while one of its raised parts must paint over it (a cover under an
	// avatar, its badge over the avatar) cannot be one layer in Figma: those parts move out of it, next to it in
	// `list` (inside a clip frame when something on the way clipped them). True when something moved.
	// where a node paints at its own layer: its box when it has a fill, border or shadow, and its content that is not
	// a raised part (null: nothing, e.g. a plain wrapper around a raised avatar)
	function bodyExt(m, raised) {
		if (raised.has(m)) return null;
		let e = m.t !== 'f' || m.bg || m.bd || (m.sh && m.sh.length) || m.layers || m.cp ? boxExt(m) : null;
		for (const c of m.ch || []) {
			const ce = bodyExt(c, raised);
			if (ce) e = e ? {x0: Math.min(e.x0, ce.x0), y0: Math.min(e.y0, ce.y0), x1: Math.max(e.x1, ce.x1), y1: Math.max(e.y1, ce.y1)} : ce;
		}
		return e;
	}

	function hoistConflicts(list, node) {
		for (let i = 0; i < list.length; i++) {
			const x = list[i];
			if (!partsOf(x).length) continue;
			const body = bodyExt(x, new Set(partsOf(x).map(p => p.n)));
			if (!body) continue;
			for (let j = 0; j < list.length; j++) {
				if (j === i) continue;
				const y = list[j], ey = extent(y);
				if (!overlap(body, ey, HOIST_MIN)) continue;
				const ky = keyAgainst(y, extent(x));
				if (over(keyOf(x), i, ky, j)) continue;
				const up = partsOf(x).filter(p => over(p.key, i, ky, j) && overlap(extent(p.n), ey, HOIST_MIN));
				if (!up.length) continue;
				for (const p of up) {
					const at = p.parent.ch.indexOf(p.n);
					if (at < 0) continue;
					p.parent.ch.splice(at, 1);
					if (p.parent.lay && !p.n.abs) delete p.parent.lay;
					EXT.delete(p.parent);
					const clip = x.clip ? isect(p.clip, {x: x.x, y: x.y, w: x.w, h: x.h}) : p.clip;
					let moved = p.n;
					moved.abs = true;
					if (clip) {
						moved = {t: 'f', n: 'clip', x: clip.x, y: clip.y, w: clip.w, h: clip.h, bg: null, br: {tl: 0, tr: 0, br: 0, bl: 0}, bd: null, sh: [], op: 1, clip: true, abs: true, ch: [moved]};
						KEY.set(moved, p.key);
					}
					list.splice(i + 1, 0, moved);
				}
				RAISED.set(x, partsOf(x).filter(p => !up.includes(p)));
				EXT.delete(x);
				if (node && node.lay) delete node.lay;
				return true;
			}
		}
		return false;
	}

	function paintOrder(list, node) {
		for (let guard = 0; guard < 20 && hoistConflicts(list, node); guard++);
		const n = list.length;
		const keys = list.map(keyOf);
		if (keys.every(k => !cmpKey(k, keys[0])) && !list.some(c => partsOf(c).length)) return;
		// below[j] = how many overlapping siblings must come before j
		const ext = list.map(extent), above = list.map(() => []), below = new Array(n).fill(0);
		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
			if (!overlap(ext[i], ext[j])) continue;
			if (!over(keyAgainst(list[i], ext[j]), i, keyAgainst(list[j], ext[i]), j)) { above[i].push(j); below[j]++; } else { above[j].push(i); below[i]++; }
		}
		// topological order, always taking the earliest node in DOM order that is free
		const out = [], done = new Array(n).fill(false);
		while (out.length < n) {
			let i = 0;
			while (done[i] || below[i]) i++;
			done[i] = true;
			out.push(i);
			for (const j of above[i]) below[j]--;
		}
		if (out.every((v, i) => v === i)) return;
		const sorted = out.map(i => list[i]);
		if (node && node.lay) {
			const flow = list.filter(c => !c.abs);
			if (sorted.filter(c => !c.abs).some((c, i) => c !== flow[i])) delete node.lay;
		}
		list.splice(0, n, ...sorted);
	}

	// Transformed elements are measured with their transform switched off, so the element and everything
	// inside it get their real (unrotated, unscaled) boxes; the transform goes on the element's node as `tf`
	// and the plugin applies it in Figma (children follow, as in the browser).
	async function walk(el, out) {
		if (SKIP_TAGS.test(el.tagName)) return;
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || parseFloat(cs.opacity) === 0) return;
		// not rendered although its own style says otherwise (content-visibility: hidden, e.g. a closed <details>)
		if (el.checkVisibility && !el.checkVisibility()) return;
		const tf = transformOf(cs);
		const stack = stackingOf(el, cs, tf);
		const start = out.length;
		const scene = ROOTS_3D.has(el);
		if (scene) {
			scene3d(el, out); // one picture, transform included
		} else if (!tf) {
			await walkElement(el, cs, out);
		} else {
			const saved = ['transform', 'rotate', 'scale', 'translate'].map(p => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
			for (const [p] of saved) el.style.setProperty(p, 'none', 'important');
			try {
				await walkElement(el, cs, out);
			} finally {
				for (const [p, v, prio] of saved) {
					if (v) el.style.setProperty(p, v, prio);
					else el.style.removeProperty(p);
				}
			}
		}
		// only on the element's own node, never on a child's (an inline element makes no node of its own)
		const mine = out.length > start && OWNER.get(out[start]) === el ? out[start] : null;
		if (mine && tf && !scene) mine.tf = tf;
		// out of the flow (position absolute / fixed): stays absolute inside an Auto Layout parent
		if (mine && /^(absolute|fixed)$/.test(cs.position)) mine.abs = true;
		if (mine) {
			// without a stacking context of its own, the element's positioned descendants paint in the parent's
			// context: they are its raised parts, which count where they overlap a sibling (a plain <header> holding
			// a fixed drawer goes over the page; a cover goes over the avatar only where its z-index button is)
			const key = stack.slice(0, 2);
			if (key[0] || key[1]) KEY.set(mine, key);
			if (!stack[2]) {
				const parts = raisedParts(mine, key);
				if (parts.length) RAISED.set(mine, parts);
			}
		} else if ((stack[0] || stack[1]) && out.length > start) {
			// no node of its own (e.g. a fixed menu wrapper with height 0, z-index 6): what it painted carries its
			// layer, so a drawer inside it still paints over the page. In a stacking context everything does; else
			// only what would paint lower.
			const key = stack.slice(0, 2);
			for (let k = start; k < out.length; k++) {
				if (stack[2] || cmpKey(keyOf(out[k]), key) < 0) KEY.set(out[k], key);
			}
		}
	}

	// Figma Auto Layout for a flex container, when it reproduces the measured positions exactly; else null.
	// {d: 'H'|'V', gap, p: [top, right, bottom, left], main: MIN|CENTER|MAX|SPACE_BETWEEN, cross: MIN|CENTER|MAX}.
	// Checked against the children as measured (in DOM order = Figma's order): no wrapping, reversed order,
	// uneven gaps or per-item alignment. Padding includes the border (Figma's strokes take no layout space).
	function autoLayoutOf(cs, node) {
		if (!/flex$/.test(cs.display) || cs.flexWrap !== 'nowrap') return null;
		const H = /^row/.test(cs.flexDirection);
		if (/reverse$/.test(cs.flexDirection)) return null;
		const items = node.ch.filter(c => !c.abs);
		if (!items.length) return null;
		const p = [px(cs.paddingTop) + px(cs.borderTopWidth), px(cs.paddingRight) + px(cs.borderRightWidth), px(cs.paddingBottom) + px(cs.borderBottomWidth), px(cs.paddingLeft) + px(cs.borderLeftWidth)];
		const TOL = 1;
		const near = (a, b) => Math.abs(a - b) <= TOL;
		// main axis: start, size of each item; container's inner start and end
		const pos = c => (H ? c.x : c.y), size = c => (H ? c.w : c.h);
		const innerStart = H ? node.x + p[3] : node.y + p[0];
		const innerEnd = H ? node.x + node.w - p[1] : node.y + node.h - p[2];
		const gaps = [];
		for (let i = 1; i < items.length; i++) gaps.push(pos(items[i]) - (pos(items[i - 1]) + size(items[i - 1])));
		if (gaps.some(g => g < -TOL)) return null; // overlapping or out of order
		if (gaps.some(g => !near(g, gaps[0]))) return null; // uneven (margins, auto margins…)
		const gap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
		const s = pos(items[0]) - innerStart, e = innerEnd - (pos(items[items.length - 1]) + size(items[items.length - 1]));
		let main;
		if (items.length > 1 && /space-between/.test(cs.justifyContent) && near(s, 0) && near(e, 0)) main = 'SPACE_BETWEEN';
		else if (near(s, 0)) main = 'MIN';
		else if (near(e, 0)) main = 'MAX';
		else if (near(s, e)) main = 'CENTER';
		else return null;
		// cross axis: every item aligned the same way
		const cpos = c => (H ? c.y : c.x), csize = c => (H ? c.h : c.w);
		const cStart = H ? node.y + p[0] : node.x + p[3], cEnd = H ? node.y + node.h - p[2] : node.x + node.w - p[1];
		const before = items.map(c => cpos(c) - cStart), after = items.map(c => cEnd - (cpos(c) + csize(c)));
		let cross;
		if (before.every(v => near(v, 0))) cross = 'MIN';
		else if (after.every(v => near(v, 0))) cross = 'MAX';
		else if (items.every((c, i) => near(before[i], after[i]))) cross = 'CENTER';
		else return null;
		const r = v => Math.round(v * 100) / 100;
		return {d: H ? 'H' : 'V', gap: r(gap), p: p.map(r), main, cross};
	}

	// gradient text: the element's background (colour and layers) becomes the fill of its see-through text, laid out
	// on the element's box (fb) as in the browser
	async function textPaint(el, cs, b, made) {
		const tmp = {ch: []};
		if (cs.backgroundImage && cs.backgroundImage !== 'none') await backgrounds(el, cs, b, tmp);
		const fill = tmp.layers || [];
		const fbg = rgba(cs.backgroundColor);
		if (!fill.length && !fbg) return;
		const paint = n => {
			if (n.t === 't' && !n.fill && !(n.c && n.c[3] > 0)) {
				n.fill = fill;
				if (fbg) n.fbg = fbg;
				n.fb = {x: b.x, y: b.y, w: b.w, h: b.h};
			}
			(n.ch || []).forEach(paint);
		};
		made.forEach(paint);
	}

	async function walkElement(el, cs, out) {
		const tag = el.tagName.toLowerCase();
		const b = box(el.getBoundingClientRect());

		if (tag === 'svg') {
			if (b.w > 0 && b.h > 0) out.push(own(el, Object.assign({t: 'svg', n: el.getAttribute('aria-label') || 'icon', svg: await svgMarkup(el, b.w, b.h)}, b, effectsOf(cs).props)));
			return;
		}
		if (tag === 'img') {
			const src = el.currentSrc || el.src;
			if (b.w > 0 && b.h > 0 && src) out.push(own(el, Object.assign({t: 'img', n: el.alt || 'image', src, fit: cs.objectFit, r: radius(cs, b.w, b.h)}, b, effectsOf(cs).props)));
			return;
		}
		if (SHOT_TAGS.test(tag)) {
			if (b.w > 0 && b.h > 0) {
				const id = String(++SHOTS);
				el.setAttribute('data-h2f-shot', id);
				out.push(own(el, Object.assign({t: 'img', n: tag, shot: id, fit: 'fill', r: radius(cs, b.w, b.h)}, b, effectsOf(cs).props)));
			}
			return;
		}
		if (tag === 'input' && (el.type === 'range' || el.type === 'hidden')) return;

		// background-clip: text: the background shows only through the letters, so it is the text's paint, not the box's
		const clipText = /text/.test(cs.backgroundClip || '') || /text/.test(cs.webkitBackgroundClip || '');
		const bg = clipText ? null : rgba(cs.backgroundColor);
		const bd = border(cs);
		const sh = shadows(cs.boxShadow);
		const hasBgImage = !clipText && cs.backgroundImage && cs.backgroundImage !== 'none';
		const visual = !!(bg || bd || sh.length || hasBgImage || Object.keys(effectsOf(cs).props).length || clipPathOf(cs, b.w, b.h));
		const isControl = /^(input|select|textarea|button)$/.test(tag);
		const clip = /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY);
		// collapsed and clipping (a closed panel: max-height 0, overflow hidden): nothing inside shows. It makes no
		// frame, so without this its content would land in the parent unclipped.
		const clipX = /hidden|clip|auto|scroll/.test(cs.overflowX), clipY = /hidden|clip|auto|scroll/.test(cs.overflowY);
		if (!INLINE.test(cs.display) && ((clipY && b.h < 0.5) || (clipX && b.w < 0.5))) return;
		const isInline = INLINE.test(cs.display) && !visual && !isControl;

		const first = out.length;
		let children = out;
		let node = null;
		if (!isInline && b.w > 0 && b.h > 0) {
			const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(c => c && !c.startsWith('__h2f') && !c.startsWith('js-'))[0];
			const fx = effectsOf(cs);
			node = Object.assign({t: 'f', n: tag + (cls ? '.' + cls : ''), bg, br: radius(cs, b.w, b.h), bd, sh: sh.concat(fx.drop), op: parseFloat(cs.opacity), clip, ch: []}, b, fx.props);
			const cp = clipPathOf(cs, b.w, b.h);
			if (cp) node.cp = cp;
			out.push(own(el, node));
			children = node.ch;
			if (hasBgImage) await backgrounds(el, cs, b, node);
		}

		if (node && /^(input|select|textarea)$/.test(tag)) {
			controlContent(el, cs, b, node);
			return;
		}

		// a closed <details> shows only its summary
		const closed = tag === 'details' && !el.open;
		const kids = [...el.childNodes].filter(child => !closed || (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SUMMARY'));
		// words and the inline elements among them are one text layer (flowText); not where every piece is laid out on
		// its own (flex/grid items), in columns, in preformatted or vertical text
		const merge = !/pre/.test(cs.whiteSpace) && cs.columnCount === 'auto' && cs.columnWidth === 'auto'
			&& !/flex|grid/.test(cs.display) && !/^(vertical|sideways)/.test(cs.writingMode);
		for (let i = 0; i < kids.length;) {
			const child = kids[i];
			if (merge && isFlowNode(child)) {
				let j = i + 1;
				while (j < kids.length && isFlowNode(kids[j])) j++;
				children.push(...flowText(kids.slice(i, j)));
				i = j;
				continue;
			}
			if (child.nodeType === Node.TEXT_NODE) {
				if (child.nodeValue.trim()) children.push(...textNodes(child, cs));
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				await walk(child, children);
			}
			i++;
		}
		if (clipText) await textPaint(el, cs, b, out.slice(first));
		if (node) {
			const lay = autoLayoutOf(cs, node); // "lay", not "al": text nodes use "al" for text-align
			if (lay) node.lay = lay;
			paintOrder(node.ch, node);
		}
	}

	async function extract(opts) {
		OPTS = Object.assign({replaceText: {}}, opts || {});
		// 3D scenes keep the frame they show now (a spinning ring mid-turn, as people see it): their animations are
		// paused where they are. Everything else is stopped (animations off: final, readable state).
		ROOTS_3D = find3dRoots(document.body);
		const live = el => [...ROOTS_3D].some(r => r === el || r.contains(el));
		for (const r of ROOTS_3D) r.setAttribute('data-h2f-live', '');
		for (const a of document.getAnimations()) {
			const t = a.effect && a.effect.target;
			if (t && live(t)) a.pause();
		}
		const still = ':not([data-h2f-live], [data-h2f-live] *)';
		const st = document.createElement('style');
		st.textContent = 'html{scrollbar-width:none!important;scroll-behavior:auto!important}::-webkit-scrollbar{display:none!important}'
			+ '*{caret-color:transparent!important}'
			+ ['', '::before', '::after'].map(p => '*' + still + p).join(',') + '{animation:none!important;transition:none!important}';
		document.head.appendChild(st);
		// to the top at once: a smooth scroll still running (scroll-behavior: smooth, a step's scrollIntoView) would
		// leave sticky elements measured part-way down the page
		for (let i = 0; i < 20; i++) {
			window.scrollTo({left: 0, top: 0, behavior: 'instant'});
			await new Promise(r => setTimeout(r, i ? 50 : 120));
			if (!scrollX && !scrollY) break;
		}
		materialisePseudo(document.body);
		materialiseMarkers(document.body); // after ::before, so a marker comes first in the line
		await document.fonts.ready;
		const W = document.documentElement.clientWidth;
		const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
		const bodyBg = rgba(getComputedStyle(document.body).backgroundColor) || rgba(getComputedStyle(document.documentElement).backgroundColor) || [1, 1, 1, 1];
		const root = {t: 'f', n: 'page', x: 0, y: 0, w: W, h: H, bg: bodyBg, br: {tl: 0, tr: 0, br: 0, bl: 0}, bd: null, sh: [], op: 1, clip: true, ch: []};
		const rootCs = getComputedStyle(document.body);
		if (rootCs.backgroundImage && rootCs.backgroundImage !== 'none') await backgrounds(document.body, rootCs, root, root);
		for (const child of document.body.childNodes) {
			if (child.nodeType === Node.ELEMENT_NODE) await walk(child, root.ch);
		}
		paintOrder(root.ch, null);
		return {width: W, height: H, title: document.title, root};
	}

	window.__html2frame = {extract};
})();
