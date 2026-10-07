const fs = require('fs');
const path = require('path');
let handler; const counts = {};
function node(type) {
	counts[type] = (counts[type] || 0) + 1;
	const n = {type, children: [], width: 10, height: 10, x: 0, y: 0,
		appendChild(c) { this.children.push(c); },
		resize(w, h) { if (!(w >= 0.01 && h >= 0.01)) throw new Error(type + ' bad size ' + w + 'x' + h); this.width = w; this.height = h; }};
	if (type === 'TEXT') {
		let font = null;
		Object.defineProperty(n, 'fontName', {set(v) { font = v; }, get() { return font; }});
		Object.defineProperty(n, 'characters', {set(v) { if (!font) throw new Error('font before chars'); this._c = v; this.width = v.length * 7; }, get() { return this._c; }});
	}
	return n;
}
const page = node('PAGE');
global.__html__ = '';
global.figma = {
	showUI() {}, ui: {set onmessage(f) { handler = f; }, postMessage(m) { if (m.type === 'done') console.log(m.text); }},
	loadFontAsync: async f => { if (f.family === 'Nope') throw new Error('x'); },
	createFrame: () => node('FRAME'), createText: () => node('TEXT'), createRectangle: () => node('RECT'),
	createNodeFromSvg: s => { if (!s.startsWith('<svg')) throw new Error('bad svg'); return node('SVG'); },
	createImage: () => ({hash: 'h'}), base64Decode: () => new Uint8Array(),
	currentPage: page, viewport: {center: {x: 0, y: 0}, scrollAndZoomIntoView() {}},
};
require(path.join(__dirname, '..', 'figma-plugin', 'code.js'));
const pages = require(path.join(__dirname, '..', '..', 'examples', 'insurenow.capture.json')).pages;
handler({type: 'import', pages}).then(() => console.log(counts, 'top-level:', page.children.length));
