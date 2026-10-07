// extract.js — runs INSIDE the page (injected by capture.js).
// Walks the rendered DOM and records what is painted, in page coordinates, as a JSON tree
// the Figma plugin rebuilds: frames (boxes), text, svg and images.
// Images are returned as URLs ({src}); capture.js downloads them, so CORS does not matter.
(function () {
	const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|HEAD|TITLE|BR|WBR|IFRAME|OBJECT|EMBED|CANVAS|VIDEO|AUDIO)$/;
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

	function rgbaAny(str) {
		const c = rgba(str);
		return c || (/transparent/.test(str) ? [0, 0, 0, 0] : null);
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

	// CSS angle of a linear-gradient: "135deg", "to right", "to top left", default 180deg
	function gradientAngle(first) {
		const deg = first.match(/^(-?[\d.]+)(deg|turn|rad)$/);
		if (deg) return deg[2] === 'turn' ? parseFloat(deg[1]) * 360 : deg[2] === 'rad' ? parseFloat(deg[1]) * 180 / Math.PI : parseFloat(deg[1]);
		if (!first.startsWith('to ')) return null;
		const k = first.slice(3).split(/\s+/).sort().join(' ');
		return {'top': 0, 'right': 90, 'bottom': 180, 'left': 270, 'right top': 45, 'bottom right': 135, 'bottom left': 225, 'left top': 315}[k] ?? 180;
	}

	function parseLinearGradient(fn) {
		const inner = fn.replace(/^(repeating-)?linear-gradient\(/, '').replace(/\)$/, '');
		const parts = splitTop(inner);
		let angle = gradientAngle(parts[0]);
		if (angle === null) angle = 180; else parts.shift();
		const stops = [];
		for (const p of parts) {
			const col = p.match(/rgba?\([^)]+\)|transparent/);
			if (!col) continue;
			const pos = p.replace(col[0], '').trim().match(/(-?[\d.]+)%/);
			stops.push({c: rgbaAny(col[0]), p: pos ? parseFloat(pos[1]) / 100 : null});
		}
		if (stops.length < 2) return null;
		stops.forEach((s, i) => { if (s.p === null) s.p = i === 0 ? 0 : i === stops.length - 1 ? 1 : null; });
		// fill missing positions evenly between known neighbours
		for (let i = 1; i < stops.length - 1; i++) {
			if (stops[i].p !== null) continue;
			let j = i;
			while (stops[j].p === null) j++;
			const a = stops[i - 1].p, b = stops[j].p, n = j - i + 1;
			for (let k = i; k < j; k++) stops[k].p = a + (b - a) * (k - i + 1) / n;
		}
		return {type: 'gradient', angle, stops};
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
			if (/linear-gradient\(/.test(layer)) {
				const g = parseLinearGradient(layer);
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
			node.ch.push({t: 'img', n: 'background', src, fit: 'fill', x, y, w: nw, h: nh});
		}
		// CSS paints the first layer on top; Figma paints the last fill on top
		if (fills.length) node.layers = fills.reverse();
	}

	function fontInfo(cs) {
		const ff = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
		return {
			ff, fw: parseInt(cs.fontWeight, 10) || 400, fs: px(cs.fontSize), it: cs.fontStyle === 'italic',
			lh: cs.lineHeight === 'normal' ? null : px(cs.lineHeight),
			ls: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
			c: rgba(cs.color) || [0, 0, 0, 1],
			tc: {uppercase: 'upper', lowercase: 'lower', capitalize: 'title'}[cs.textTransform] || 'none',
			td: /underline/.test(cs.textDecorationLine) ? 'underline' : /line-through/.test(cs.textDecorationLine) ? 'strike' : 'none',
		};
	}

	function box(r) {
		return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height};
	}

	function textNode(text, rects, bound, cs) {
		const f = fontInfo(cs);
		const lines = Math.max(1, new Set([...rects].filter(r => r.width > 0).map(r => Math.round(r.top))).size);
		const b = box(bound);
		const contentH = rects.length ? rects[0].height : b.h;
		const y = f.lh ? b.y - (f.lh - contentH) / 2 : b.y;
		const h = f.lh ? f.lh * lines : b.h;
		const al = {start: 'left', end: 'right', justify: 'left', '-webkit-center': 'center'}[cs.textAlign] || cs.textAlign;
		return Object.assign({t: 't', s: text, x: b.x, y, w: b.w, h, al, multi: lines > 1}, f);
	}

	function svgMarkup(liveSvg, w, h) {
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
		});
		clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		clone.setAttribute('width', w);
		clone.setAttribute('height', h);
		if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
		return replaceText(clone.outerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/currentColor/g, getComputedStyle(liveSvg).color));
	}

	// ::before / ::after -> real spans, so they can be measured like anything else
	function materialisePseudo(root) {
		const st = document.createElement('style');
		st.textContent = '.__h2f-b::before{content:none!important}.__h2f-a::after{content:none!important}';
		document.head.appendChild(st);
		for (const el of [...root.querySelectorAll('*')]) {
			if (el.closest('svg')) continue;
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
		node.ch.push(Object.assign({}, f, {
			t: 't', s: replaceText(text), x: b.x + pl, y: multi ? b.y + pt : b.y + (b.h - lh) / 2,
			w: Math.max(1, b.w - pl - pr), h: multi ? b.h - pt * 2 : lh, lh,
			al: {center: 'center', right: 'right', end: 'right'}[cs.textAlign] || 'left', multi, fixed: true,
		}));
	}

	async function walk(el, out) {
		if (SKIP_TAGS.test(el.tagName)) return;
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || parseFloat(cs.opacity) === 0) return;
		const tag = el.tagName.toLowerCase();
		const b = box(el.getBoundingClientRect());

		if (tag === 'svg') {
			if (b.w > 0 && b.h > 0) out.push(Object.assign({t: 'svg', n: el.getAttribute('aria-label') || 'icon', svg: svgMarkup(el, b.w, b.h)}, b));
			return;
		}
		if (tag === 'img') {
			const src = el.currentSrc || el.src;
			if (b.w > 0 && b.h > 0 && src) out.push(Object.assign({t: 'img', n: el.alt || 'image', src, fit: cs.objectFit, r: radius(cs, b.w, b.h)}, b));
			return;
		}
		if (tag === 'input' && (el.type === 'range' || el.type === 'hidden')) return;

		const bg = rgba(cs.backgroundColor);
		const bd = border(cs);
		const sh = shadows(cs.boxShadow);
		const hasBgImage = cs.backgroundImage && cs.backgroundImage !== 'none';
		const visual = !!(bg || bd || sh.length || hasBgImage);
		const isControl = /^(input|select|textarea|button)$/.test(tag);
		const clip = /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY);
		const isInline = INLINE.test(cs.display) && !visual && !isControl;

		let children = out;
		let node = null;
		if (!isInline && b.w > 0 && b.h > 0) {
			const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(c => c && !c.startsWith('__h2f') && !c.startsWith('js-'))[0];
			node = Object.assign({t: 'f', n: tag + (cls ? '.' + cls : ''), bg, br: radius(cs, b.w, b.h), bd, sh, op: parseFloat(cs.opacity), clip, ch: []}, b);
			out.push(node);
			children = node.ch;
			if (hasBgImage) await backgrounds(el, cs, b, node);
		}

		if (node && /^(input|select|textarea)$/.test(tag)) {
			controlContent(el, cs, b, node);
			return;
		}

		for (const child of el.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) {
				const raw = child.nodeValue;
				if (!raw.trim()) continue;
				const text = replaceText(/pre/.test(cs.whiteSpace) ? raw : raw.replace(/\s+/g, ' ').trim());
				const range = document.createRange();
				range.selectNodeContents(child);
				const bound = range.getBoundingClientRect();
				if (bound.width === 0 || bound.height === 0) continue;
				children.push(textNode(text, range.getClientRects(), bound, cs));
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				await walk(child, children);
			}
		}
	}

	async function extract(opts) {
		OPTS = Object.assign({replaceText: {}}, opts || {});
		const st = document.createElement('style');
		st.textContent = 'html{scrollbar-width:none!important;scroll-behavior:auto!important}::-webkit-scrollbar{display:none!important}'
			+ '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
		document.head.appendChild(st);
		window.scrollTo(0, 0);
		await new Promise(r => setTimeout(r, 120));
		materialisePseudo(document.body);
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
		return {width: W, height: H, title: document.title, root};
	}

	window.__htmlToFigma = {extract};
})();
