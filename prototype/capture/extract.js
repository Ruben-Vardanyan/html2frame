// extract.js — walks the rendered page and records what is painted, in page coordinates,
// as a JSON tree the Figma plugin can rebuild: frames (boxes), text, svg and images.
// ֏ is written as "AMD" (DM Sans has no dram glyph).

const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|HEAD|TITLE|BR|WBR)$/;
const INLINE = /^(inline|contents)$/;

function rgba(str) {
	if (!str) return null;
	const m = str.match(/rgba?\(([^)]+)\)/);
	if (!m) return null;
	const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
	const a = p.length > 3 ? p[3] : 1;
	if (a === 0) return null;
	return [p[0] / 255, p[1] / 255, p[2] / 255, a];
}

function px(v) {
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : 0;
}

function splitTop(str) {
	// split on commas that are not inside parentheses
	const out = [];
	let depth = 0, cur = '';
	for (const ch of str) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
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
	const w = sides.map(s => (cs['border' + s + 'Style'] === 'none' || cs['border' + s + 'Style'] === 'hidden') ? 0 : px(cs['border' + s + 'Width']));
	const i = w.findIndex(v => v > 0);
	if (i < 0) return null;
	const c = rgba(cs['border' + sides[i] + 'Color']);
	if (!c) return null;
	return {w, c, dash: cs['border' + sides[i] + 'Style'] === 'dashed' || cs['border' + sides[i] + 'Style'] === 'dotted'};
}

function fontInfo(cs) {
	const ff = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
	const fs = px(cs.fontSize);
	const lh = cs.lineHeight === 'normal' ? null : px(cs.lineHeight);
	return {
		ff, fw: parseInt(cs.fontWeight, 10) || 400, fs, it: cs.fontStyle === 'italic',
		lh, ls: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
		c: rgba(cs.color) || [0, 0, 0, 1],
		tc: cs.textTransform === 'uppercase' ? 'upper' : cs.textTransform === 'lowercase' ? 'lower' : cs.textTransform === 'capitalize' ? 'title' : 'none',
		td: /underline/.test(cs.textDecorationLine) ? 'underline' : /line-through/.test(cs.textDecorationLine) ? 'strike' : 'none',
	};
}

function box(r) {
	return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height};
}

function textNodeFor(text, rects, bound, cs, alignW) {
	const f = fontInfo(cs);
	const lineTops = new Set([...rects].filter(r => r.width > 0).map(r => Math.round(r.top)));
	const lines = Math.max(1, lineTops.size);
	const b = box(bound);
	const contentH = rects.length ? rects[0].height : b.h;
	const lh = f.lh;
	const y = lh ? b.y - (lh - contentH) / 2 : b.y;
	const h = lh ? lh * lines : b.h;
	let al = cs.textAlign;
	if (al === 'start') al = 'left';
	if (al === 'end') al = 'right';
	if (al === 'justify') al = 'left';
	return Object.assign({t: 't', s: text, x: b.x, y, w: b.w, h, al, multi: lines > 1, nowrap: /nowrap|pre/.test(cs.whiteSpace)}, f, alignW || {});
}

function svgMarkup(liveSvg, w, h) {
	const clone = liveSvg.cloneNode(true);
	const liveAll = [liveSvg, ...liveSvg.querySelectorAll('*')];
	const cloneAll = [clone, ...clone.querySelectorAll('*')];
	liveAll.forEach((el, i) => {
		const c = cloneAll[i];
		if (!/^(path|circle|rect|line|polyline|polygon|ellipse|g|svg|text|use)$/i.test(el.tagName)) return;
		const cs = getComputedStyle(el);
		const fill = cs.fill, stroke = cs.stroke;
		if (fill) c.setAttribute('fill', fill.startsWith('url(') ? c.getAttribute('fill') || fill : fill);
		if (stroke) c.setAttribute('stroke', stroke.startsWith('url(') ? c.getAttribute('stroke') || stroke : stroke);
		if (cs.strokeWidth) c.setAttribute('stroke-width', px(cs.strokeWidth));
		if (cs.opacity && cs.opacity !== '1') c.setAttribute('opacity', cs.opacity);
		c.removeAttribute('class');
		c.removeAttribute('style');
	});
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	clone.setAttribute('width', w);
	clone.setAttribute('height', h);
	if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
	return clone.outerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/currentColor/g, getComputedStyle(liveSvg).color).replace(/֏/g, 'AMD');
}

async function imgNode(img) {
	const b = box(img.getBoundingClientRect());
	const src = img.currentSrc || img.src;
	try {
		const res = await fetch(src);
		const type = res.headers.get('content-type') || '';
		if (/svg/.test(type) || /\.svg(\?|$)/.test(src)) {
			let txt = await res.text();
			const holder = document.createElement('div');
			holder.innerHTML = txt.replace(/<!--[\s\S]*?-->/g, '');
			const svg = holder.querySelector('svg');
			svg.setAttribute('width', b.w);
			svg.setAttribute('height', b.h);
			return Object.assign({t: 'svg', n: img.alt || 'image', svg: svg.outerHTML}, b);
		}
		const buf = new Uint8Array(await (await fetch(src)).arrayBuffer());
		let bin = '';
		for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
		return Object.assign({t: 'img', n: img.alt || 'image', data: btoa(bin), fit: getComputedStyle(img).objectFit}, b);
	} catch (e) {
		return null;
	}
}

// Turn ::before / ::after into real spans so they can be measured like anything else.
function materialisePseudo(root) {
	if (!document.getElementById('__nopseudo')) {
		const st = document.createElement('style');
		st.id = '__nopseudo';
		st.textContent = '.__nopseudo-b::before{content:none!important}.__nopseudo-a::after{content:none!important}';
		document.head.appendChild(st);
	}
	for (const el of [...root.querySelectorAll('*')]) {
		if (el.closest('svg')) continue;
		for (const which of ['before', 'after']) {
			const cs = getComputedStyle(el, '::' + which);
			const content = cs.content;
			if (!content || content === 'none' || content === 'normal') continue;
			const span = document.createElement('span');
			for (let i = 0; i < cs.length; i++) {
				const p = cs[i];
				span.style.setProperty(p, cs.getPropertyValue(p));
			}
			const m = content.match(/^"(.*)"$/s);
			span.textContent = m ? m[1].replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))) : '';
			span.dataset.pseudo = which;
			if (which === 'before') el.insertBefore(span, el.firstChild); else el.appendChild(span);
			el.classList.add('__nopseudo-' + which[0]);
		}
	}
}

async function walk(el, out) {
	if (SKIP_TAGS.test(el.tagName)) return;
	const cs = getComputedStyle(el);
	if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || parseFloat(cs.opacity) === 0) return;
	const tag = el.tagName.toLowerCase();
	const r = el.getBoundingClientRect();
	const b = box(r);

	if (tag === 'svg') {
		if (b.w > 0 && b.h > 0) out.push(Object.assign({t: 'svg', n: 'icon', svg: svgMarkup(el, b.w, b.h)}, b));
		return;
	}
	if (tag === 'img') {
		if (b.w > 0 && b.h > 0) { const n = await imgNode(el); if (n) out.push(n); }
		return;
	}
	if (tag === 'input' && el.type === 'range') return;
	if (tag === 'input' && el.type === 'hidden') return;

	const bg = rgba(cs.backgroundColor);
	const bd = border(cs);
	const sh = shadows(cs.boxShadow);
	const visual = !!(bg || bd || sh.length);
	const clip = /hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY) && tag !== 'html' && tag !== 'body';
	const isInline = INLINE.test(cs.display) && !visual && tag !== 'input' && tag !== 'select' && tag !== 'textarea' && tag !== 'button';

	let children = out;
	let node = null;
	if (!isInline && b.w > 0 && b.h > 0) {
		const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/).filter(c => !c.startsWith('__') && !c.startsWith('js-'))[0] : '';
		node = Object.assign({t: 'f', n: tag + (cls && cls !== '.undefined' ? cls : ''), bg, br: radius(cs, b.w, b.h), bd, sh, op: parseFloat(cs.opacity), clip, ch: []}, b);
		out.push(node);
		children = node.ch;
	}

	// form controls draw their own content
	if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
		const accent = rgba(cs.accentColor) || [31 / 255, 38 / 255, 232 / 255, 1];
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
	if (tag === 'input' || tag === 'textarea' || tag === 'select') {
		let text = '', textCs = cs, placeholder = false;
		if (tag === 'select') text = el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
		else if (el.type === 'password' && el.value) text = '•'.repeat(el.value.length);
		else if (el.value) text = el.value;
		else if (el.placeholder) { text = el.placeholder; placeholder = true; }
		if (text && node) {
			const pl = px(cs.paddingLeft) + px(cs.borderLeftWidth), pr = px(cs.paddingRight) + px(cs.borderRightWidth);
			const pt = px(cs.paddingTop) + px(cs.borderTopWidth);
			const f = fontInfo(cs);
			if (placeholder) f.c = rgba(getComputedStyle(el, '::placeholder').color) || [0.54, 0.56, 0.64, 1];
			const lh = f.lh || f.fs * 1.3;
			const ty = tag === 'textarea' ? b.y + pt : b.y + (b.h - lh) / 2;
			node.ch.push(Object.assign({}, f, {t: 't', s: text.replace(/֏/g, 'AMD'), x: b.x + pl, y: ty, w: Math.max(1, b.w - pl - pr), h: tag === 'textarea' ? b.h - pt * 2 : lh, lh, al: cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left', multi: tag === 'textarea', nowrap: tag !== 'textarea', fixed: true}));
		}
		// a background-image chevron (custom selects)
		const bi = cs.backgroundImage;
		const m = bi && bi.match(/url\("data:image\/svg\+xml,([^"]+)"\)/);
		if (m && node) {
			let svg = decodeURIComponent(m[1]);
			const sw = px((svg.match(/width='([\d.]+)'/) || svg.match(/width="([\d.]+)"/) || [0, 12])[1]);
			const sh2 = px((svg.match(/height='([\d.]+)'/) || svg.match(/height="([\d.]+)"/) || [0, 8])[1]);
			const right = px(cs.paddingRight) > 30 ? 16 : 12;
			node.ch.push({t: 'svg', n: 'chevron', svg, x: b.x + b.w - right - sw, y: b.y + (b.h - sh2) / 2, w: sw, h: sh2});
		}
		return;
	}

	for (const child of el.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			const raw = child.nodeValue;
			if (!raw.trim()) continue;
			const pre = /pre/.test(cs.whiteSpace);
			const text = (pre ? raw : raw.replace(/\s+/g, ' ').trim()).replace(/ ?֏/g, ' AMD');
			const range = document.createRange();
			range.selectNodeContents(child);
			const rects = range.getClientRects();
			const bound = range.getBoundingClientRect();
			if (bound.width === 0 || bound.height === 0) continue;
			children.push(textNodeFor(text, rects, bound, cs));
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			await walk(child, children);
		}
	}
}

export async function extract(name, group) {
	// the site hides <body> (html.i18n-pending) until translations are applied
	for (let i = 0; i < 50 && document.documentElement.classList.contains('i18n-pending'); i++) await new Promise(r => setTimeout(r, 100));
	// no scrollbar, so the layout uses the full viewport width
	const st = document.createElement('style');
	st.textContent = 'html{scrollbar-width:none}::-webkit-scrollbar{display:none}';
	document.head.appendChild(st);
	window.scrollTo(0, 0);
	document.documentElement.style.scrollBehavior = 'auto';
	await new Promise(r => setTimeout(r, 150)); // (rAF never fires while the browser pane is hidden)
	void document.body.offsetHeight;
	materialisePseudo(document.body);
	await document.fonts.ready;
	const W = document.documentElement.clientWidth;
	const H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
	const bodyCs = getComputedStyle(document.body);
	const root = {t: 'f', n: name, x: 0, y: 0, w: W, h: H, bg: rgba(bodyCs.backgroundColor) || rgba(getComputedStyle(document.documentElement).backgroundColor) || [1, 1, 1, 1], br: {tl: 0, tr: 0, br: 0, bl: 0}, bd: null, sh: [], op: 1, clip: true, ch: []};
	for (const child of document.body.childNodes) {
		if (child.nodeType === Node.ELEMENT_NODE) await walk(child, root.ch);
	}
	return {name, group, url: location.pathname + location.search, width: W, height: H, root};
}

export async function extractAndSave(name, group) {
	const page = await extract(name, group);
	const body = JSON.stringify(page);
	const res = await fetch('http://localhost:5502/save?name=' + encodeURIComponent(name), {method: 'POST', body});
	return {name, ok: res.ok, size: body.length, width: page.width, height: page.height};
}
