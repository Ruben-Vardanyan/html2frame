// Serialises the rendered page into compact, self-contained HTML for html.to.design.
export async function build() {
	const W = 1440;
	const PSEUDO = /::?(before|after|placeholder|marker|selection|-webkit-[\w-]+|-moz-[\w-]+)/g;
	const STATE = /:(hover|focus|focus-visible|focus-within|active|visited|disabled|invalid|valid|placeholder-shown|target)\b(\([^)]*\))?/;
	let root = document;
	const keepSel = sel => {
		if (STATE.test(sel) && !/:disabled/.test(sel)) return false;
		const s = sel.replace(PSEUDO, '').replace(/:(checked|disabled)/g, m => m).trim();
		if (!s || s === '*') return true;
		if (/(^|[\s>+~,(])(html|body|:root)(?![\w-])/.test(s)) return true;
		try { return !!root.querySelector(s); } catch (e) { return true; }
	};
	const walk = rules => {
		let out = '';
		for (const r of rules) {
			if (r instanceof CSSStyleRule) {
				const parts = r.selectorText.split(',').filter(keepSel);
				if (parts.length) out += parts.join(',') + '{' + r.style.cssText.replace(/transition[^;]*;|cursor[^;]*;|-webkit-tap[^;]*;|scroll-behavior[^;]*;/g, '') + '}';
			} else if (r instanceof CSSMediaRule) {
				if (matchMedia(r.conditionText || r.media.mediaText).matches) out += walk(r.cssRules);
			} else if (r instanceof CSSSupportsRule) out += walk(r.cssRules);
		}
		return out;
	};
	// ֏ -> "AMD" (DM Sans has no dram glyph, so Figma would show a gap)
	const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const hits = [];
	while (tw.nextNode()) if (tw.currentNode.nodeValue.includes('֏')) hits.push(tw.currentNode);
	for (const t of hits) t.nodeValue = t.nodeValue.replace(/ ?֏/g, ' AMD');

	const live = [...document.body.querySelectorAll('*')];
	const clone = document.body.cloneNode(true);
	const cl = [...clone.querySelectorAll('*')];
	for (let i = live.length - 1; i >= 0; i--) {
		const el = live[i], c = cl[i];
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || /^(SCRIPT|NOSCRIPT|TEMPLATE|LINK|DIALOG)$/.test(el.tagName) && !el.open) { c.remove(); continue; }
		if (cs.position === 'fixed') { c.remove(); continue; }
		for (const a of [...c.attributes]) if (/^(data-|aria-|on)/.test(a.name) || /^(role|tabindex|href|id|for|name|autocomplete|novalidate|action|method|loading|srcset|target|rel)$/.test(a.name)) c.removeAttribute(a.name);
		if ((c.tagName === 'INPUT' || c.tagName === 'TEXTAREA') && el.value && el.type !== 'password') c.setAttribute('value', el.value);
		if (c.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio') && el.checked) c.setAttribute('checked', '');
		if (c.tagName === 'SELECT') [...c.options].forEach((o, j) => { if (j === el.selectedIndex) o.setAttribute('selected', ''); else o.remove(); });
		if (c.tagName.toLowerCase() === 'svg') {
			// resolve currentColor so the importer does not need to
			const col = cs.color;
			c.querySelectorAll('[stroke="currentColor"]').forEach(n => n.setAttribute('stroke', col));
			c.querySelectorAll('[fill="currentColor"]').forEach(n => n.setAttribute('fill', col));
			if (c.getAttribute('stroke') === 'currentColor') c.setAttribute('stroke', col);
			if (c.getAttribute('fill') === 'currentColor') c.setAttribute('fill', col);
		}
	}

	// <img> -> inline SVG (logos) or data URI
	let clipN = 0;
	for (const img of [...clone.querySelectorAll('img')]) {
		const src = new URL(img.getAttribute('src'), location.href).href;
		try {
			const res = await fetch(src);
			if (/svg/.test(res.headers.get('content-type') || '') || src.endsWith('.svg')) {
				let txt = (await res.text()).replace(/<!--[\s\S]*?-->/g, '').replace(/\s*(role|aria-label)="[^"]*"/g, '').replace(/>\s+</g, '><').trim();
				const ids = [...txt.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
				for (const id of ids) { const n = id + '_' + (++clipN); txt = txt.split('id="' + id + '"').join('id="' + n + '"').split('#' + id + ')').join('#' + n + ')'); }
				const box = document.createElement('div'); box.innerHTML = txt;
				const svg = box.querySelector('svg');
				svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
				if (img.className) svg.setAttribute('class', img.className);
				img.replaceWith(svg);
			} else {
				const b = await res.blob();
				img.src = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
			}
		} catch (e) {}
	}

	const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
	const cm = []; while (walker.nextNode()) cm.push(walker.currentNode); cm.forEach(n => n.remove());

	// range sliders do not import; the styled track/fill divs around them stay
	clone.querySelectorAll('input[type=range]').forEach(n => n.remove());

	// CSS: keep only rules that match something in the cleaned clone
	root = clone;
	let css = '';
	for (const sh of document.styleSheets) { try { css += walk(sh.cssRules); } catch (e) {} }
	// flex cards sized to exactly fill a row wrap in Figma on rounding; leave 1px of slack
	css = css.replace(/calc\((\d+(?:\.\d+)?)% - (\d+(?:\.\d+)?)px\)/g, (m, p, g) => 'calc(' + p + '% - ' + (parseFloat(g) + 1) + 'px)');
	css = css.replace(/position: sticky;/g, 'position: relative;').replace(/100s?vh/g, '900px');
	css = 'html,body{width:' + W + 'px;max-width:' + W + 'px;overflow:hidden}' + css;

	let body = clone.innerHTML.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/ class=""/g, '');
	const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=' + W + '"><link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"><style>' + css.replace(/\s+/g, ' ').replace(/: /g, ':').replace(/; /g, ';').replace(/ \{/g, '{') + '</style></head><body' + (document.body.className ? ' class="' + document.body.className + '"' : '') + '>' + body + '</body></html>';
	window.__h2d = html;
	return { title: document.title, len: html.length, h: document.documentElement.scrollHeight };
}
