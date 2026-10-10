// trash.js — checks src/trash.js on this computer: makes a few files in captures/ (names with a space, a quote and
// Armenian letters), moves them to the recycle bin / Trash and checks they are gone. Run it on Windows and macOS:
// node test/trash.js
// The files are left in the recycle bin / Trash (empty it, or "Put Back" one to check that works). Exit code 1 on failure.

const fs = require('fs');
const path = require('path');
const {trashFiles} = require('../src/trash');

const dir = path.join(__dirname, '..', 'captures');
fs.mkdirSync(dir, {recursive: true});
const stamp = Date.now().toString(36);
const names = ['h2f-trash-test ' + stamp + '.json', "h2f-trash-test it's " + stamp + '.json', 'h2f-trash-test Հայերեն ' + stamp + '.json'];
const files = names.map(n => path.join(dir, n));
for (const f of files) fs.writeFileSync(f, '{"test": true}\n');

(async () => {
	const t = Date.now();
	const r = await trashFiles(files.concat(path.join(dir, 'h2f-no-such-file.json')));
	let bad = 0;
	for (const f of files) {
		const ok = !fs.existsSync(f) && r.removed.includes(f);
		if (!ok) bad++;
		console.log((ok ? 'ok   ' : 'FAIL ') + path.basename(f));
	}
	for (const x of r.failed) console.log('     ' + path.basename(x.file) + ': ' + x.error);
	console.log(bad ? bad + ' file(s) not moved to the Trash.' : 'All ' + files.length + ' files moved to the Trash (' + process.platform + ', ' + (Date.now() - t) + ' ms).');
	process.exit(bad ? 1 : 0);
})();
