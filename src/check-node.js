// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// check-node.js — is this Node.js new enough? Written in old JavaScript (var, no arrows) on purpose: an old Node
// must be able to read this file to say that it is too old, before setup.js (modern syntax) is loaded.
// The minimum comes from package.json "engines" (playwright-core's own minimum), so it is written in one place.
'use strict';

var fs = require('fs');
var path = require('path');

function minimum() {
	try {
		var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
		var m = /(\d+)/.exec(pkg.engines && pkg.engines.node || '');
		if (m) return Number(m[1]);
	} catch (e) {}
	return 20;
}

// HTML2FRAME_FAKE_NODE=18 pretends to be that version (to test the message)
function current() {
	var v = process.env.HTML2FRAME_FAKE_NODE || process.versions.node;
	return {text: v, major: Number(String(v).split('.')[0]) || 0};
}

function check() {
	var min = minimum();
	var cur = current();
	return {ok: cur.major >= min, version: cur.text, minimum: min,
		message: cur.major >= min ? '' : 'Node.js ' + cur.text + ' is too old. Please install Node.js ' + min + ' or newer from https://nodejs.org (the LTS version), then start html2frame again.'};
}

module.exports = {check: check, minimum: minimum};
