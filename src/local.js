// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// local.js — this computer's own html2frame files, in the git-ignored .html2frame/ folder (D21):
//   check.json   the saved result of the setup check (setup.js), so later starts skip it
//   state.json   the icon answers, the update check (time, latest version) and the last update's outcome
//   setup.log, logs/server.log, update/ (download), backup/ (the last version before an update), files.json
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.html2frame');

const file = name => path.join(DIR, name);

function readJson(f, fallback) {
	try {
		return JSON.parse(fs.readFileSync(f, 'utf8'));
	} catch (e) {
		return fallback;
	}
}

function writeJson(f, data) {
	fs.mkdirSync(path.dirname(f), {recursive: true});
	fs.writeFileSync(f, JSON.stringify(data, null, '\t') + '\n');
}

const readState = () => readJson(file('state.json'), {});
// merges the given fields into state.json and returns the new state
function writeState(patch) {
	const s = Object.assign(readState(), patch);
	writeJson(file('state.json'), s);
	return s;
}

const version = () => readJson(path.join(ROOT, 'package.json'), {}).version || '0.0.0';

// "0.10.2" > "0.9.9"
function newer(a, b) {
	const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
	}
	return false;
}

module.exports = {ROOT, DIR, file, readJson, writeJson, readState, writeState, version, newer};
