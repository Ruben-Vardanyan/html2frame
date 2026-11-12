// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// start.js — what the Start files and the html2frame icons run (D21): node src/start.js
// Written in old JavaScript (var, no arrows) on purpose: an old Node must be able to read this file to say that it
// is too old. Only then setup.js (modern syntax) is loaded: it checks the rest and saves the result. The panel then
// runs in this same window: it stays open while html2frame runs; Quit in the panel, or closing the window, stops it.
// Exit code 1: something is missing (the message was printed; the Start file waits for a key).
'use strict';

var nodeCheck = require('./check-node').check();

if (!nodeCheck.ok) {
	console.log('\n  ' + (process.stdout.isTTY ? '\x1b[31m[!!]\x1b[0m ' : '[!!] ') + nodeCheck.message + '\n');
	process.exitCode = 1;
} else {
	require('./setup').main().then(function (code) {
		if (code) {
			process.exitCode = code;
			return;
		}
		process.argv.push('--open');
		if (process.env.HTML2FRAME_PORT) process.argv.push('--port', process.env.HTML2FRAME_PORT);
		require('../server');
	}, function (e) {
		console.log('\n  [!!] ' + (e && e.stack || e) + '\n');
		process.exitCode = 1;
	});
}
