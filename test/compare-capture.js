// compare-capture.js — compares page sizes of a capture with a reference capture (exact match).
// node test/compare-capture.js captures/<new>.json captures/<old>.json [--screen desktop]
// Accepts FORMAT v1 ({captures}) and prototype ({pages}) files. Exit code 1 on any difference.

const fs = require('fs');

function pages(file, screen) {
	const d = JSON.parse(fs.readFileSync(file, 'utf8'));
	const list = d.captures || d.pages || [];
	return list.filter(p => !screen || !p.screen || p.screen.id === screen);
}

const args = process.argv.slice(2);
const si = args.indexOf('--screen');
const screen = si >= 0 ? args.splice(si, 2)[1] : null;
if (args.length < 2) {
	console.log('Usage: node test/compare-capture.js <capture.json> <reference.json> [--screen id]');
	process.exit(2);
}
const got = pages(args[0], screen), want = pages(args[1], screen);
const byName = new Map(got.map(p => [p.name, p]));
let bad = 0;
const rows = [];
for (const w of want) {
	const g = byName.get(w.name);
	byName.delete(w.name);
	const ok = g && g.width === w.width && g.height === w.height;
	if (!ok) bad++;
	rows.push([ok ? 'ok' : 'DIFF', w.name, w.width + 'x' + w.height, g ? g.width + 'x' + g.height : 'missing']);
}
for (const g of byName.values()) rows.push(['extra', g.name, '-', g.width + 'x' + g.height]);

const widths = [0, 1, 2, 3].map(i => Math.max(...rows.map(r => r[i].length), ['', 'page', 'reference', 'capture'][i].length));
const line = r => r.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(line(['', 'page', 'reference', 'capture']));
rows.forEach(r => console.log(line(r)));
console.log('\n' + (want.length - bad) + ' / ' + want.length + ' page sizes match.');
process.exit(bad ? 1 : 0);
