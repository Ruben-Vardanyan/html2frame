// code.js — rebuilds pages captured by extract.js as Figma frames, text, vectors and images.
// Every node carries absolute page coordinates; children are placed relative to their parent.

figma.showUI(__html__, {width: 340, height: 260});

const WEIGHTS = {100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'};
const fontCache = {};

function styleName(fw, it) {
	const w = WEIGHTS[Math.round(fw / 100) * 100] || 'Regular';
	if (!it) return w;
	return w === 'Regular' ? 'Italic' : w + ' Italic';
}

async function tryLoad(font) {
	try {
		await figma.loadFontAsync(font);
		return true;
	} catch (e) {
		return false;
	}
}

async function resolveFont(ff, fw, it) {
	const key = ff + '|' + fw + '|' + it;
	if (fontCache[key]) return fontCache[key];
	const style = styleName(fw, it);
	const candidates = [
		{family: ff, style},
		{family: ff, style: style.replace('SemiBold', 'Semi Bold').replace('ExtraBold', 'Extra Bold')},
		{family: ff, style: 'Regular'},
		{family: 'Inter', style},
		{family: 'Inter', style: style.replace('SemiBold', 'Semi Bold')},
		{family: 'Inter', style: 'Regular'},
	];
	for (const c of candidates) {
		if (await tryLoad(c)) {
			fontCache[key] = c;
			return c;
		}
	}
	return {family: 'Inter', style: 'Regular'};
}

function solid(c) {
	return {type: 'SOLID', color: {r: c[0], g: c[1], b: c[2]}, opacity: c[3] === undefined ? 1 : c[3]};
}

function collectFonts(node, set) {
	if (node.t === 't') set[node.ff + '|' + node.fw + '|' + !!node.it] = [node.ff, node.fw, !!node.it];
	if (node.ch) node.ch.forEach(c => collectFonts(c, set));
}

function applyBox(f, n) {
	f.fills = n.bg ? [solid(n.bg)] : [];
	if (n.br) {
		f.topLeftRadius = n.br.tl;
		f.topRightRadius = n.br.tr;
		f.bottomRightRadius = n.br.br;
		f.bottomLeftRadius = n.br.bl;
	}
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
	if (n.sh && n.sh.length) {
		f.effects = n.sh.map(s => ({
			type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
			color: {r: s.c[0], g: s.c[1], b: s.c[2], a: s.c[3]},
			offset: {x: s.x, y: s.y}, radius: s.blur, spread: s.spread,
		}));
	}
	if (n.op !== undefined && n.op < 1) f.opacity = n.op;
	f.clipsContent = !!n.clip;
}

async function build(parent, n, ox, oy) {
	if (n.t === 'f') {
		const f = figma.createFrame();
		f.name = n.n || 'frame';
		f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
		f.x = n.x - ox;
		f.y = n.y - oy;
		applyBox(f, n);
		parent.appendChild(f);
		for (const c of n.ch || []) await build(f, c, n.x, n.y);
		return;
	}
	if (n.t === 't') {
		const t = figma.createText();
		t.fontName = await resolveFont(n.ff, n.fw, !!n.it);
		t.characters = n.s;
		t.fontSize = n.fs;
		t.fills = [solid(n.c)];
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
		return;
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
			parent.appendChild(v);
		} catch (e) {
			// unsupported svg: leave a placeholder box so the layout stays readable
			const r = figma.createRectangle();
			r.name = 'svg (not imported)';
			r.resize(Math.max(n.w, 1), Math.max(n.h, 1));
			r.x = n.x - ox;
			r.y = n.y - oy;
			r.fills = [solid([0.87, 0.88, 0.92, 1])];
			parent.appendChild(r);
		}
		return;
	}
	if (n.t === 'img') {
		const r = figma.createRectangle();
		r.name = n.n || 'image';
		r.resize(Math.max(n.w, 1), Math.max(n.h, 1));
		r.x = n.x - ox;
		r.y = n.y - oy;
		const img = figma.createImage(figma.base64Decode(n.data));
		r.fills = [{type: 'IMAGE', imageHash: img.hash, scaleMode: n.fit === 'contain' ? 'FIT' : 'FILL'}];
		parent.appendChild(r);
	}
}

figma.ui.onmessage = async (msg) => {
	if (msg.type !== 'import') return;
	const pages = msg.pages;
	try {
		figma.ui.postMessage({type: 'progress', text: 'Loading fonts…'});
		const set = {};
		pages.forEach(p => collectFonts(p.root, set));
		for (const k of Object.keys(set)) await resolveFont(set[k][0], set[k][1], set[k][2]);

		// one row per group (Public / Customer / Admin), pages left to right
		const GAP_X = 200, GAP_Y = 400;
		const groups = [];
		pages.forEach(p => {
			const g = p.group || 'Pages';
			let row = groups.find(r => r.name === g);
			if (!row) groups.push(row = {name: g, pages: []});
			row.pages.push(p);
		});
		const start = figma.viewport.center;
		let y = Math.round(start.y);
		const created = [];
		let done = 0;
		for (const row of groups) {
			let x = Math.round(start.x);
			let rowH = 0;
			const label = figma.createText();
			label.fontName = await resolveFont('Inter', 700, false);
			label.characters = row.name;
			label.fontSize = 64;
			label.x = x;
			label.y = y - 120;
			figma.currentPage.appendChild(label);
			for (const p of row.pages) {
				figma.ui.postMessage({type: 'progress', text: 'Building ' + (++done) + ' / ' + pages.length + ': ' + p.name});
				const root = Object.assign({}, p.root, {x: 0, y: 0});
				const holder = {appendChild: (n) => figma.currentPage.appendChild(n)};
				await build(holder, root, 0, 0);
				const frame = figma.currentPage.children[figma.currentPage.children.length - 1];
				frame.name = p.name;
				frame.x = x;
				frame.y = y;
				frame.clipsContent = true;
				created.push(frame);
				x += p.width + GAP_X;
				rowH = Math.max(rowH, p.height);
			}
			y += rowH + GAP_Y;
		}
		figma.viewport.scrollAndZoomIntoView(created);
		figma.ui.postMessage({type: 'done', text: 'Done: ' + created.length + ' page(s) imported.'});
	} catch (e) {
		figma.ui.postMessage({type: 'done', text: 'Error: ' + (e && e.message ? e.message : e)});
	}
};
