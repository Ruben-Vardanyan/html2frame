// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// setup.js — the setup check and the start (D21). Run through src/start.js, which checks Node.js first.
// The first start checks this computer item by item, asks about the icons and saves the result in
// .html2frame/check.json; start.js then runs the panel in the same window. Later starts only compare check.json with this
// computer (Node.js version and path, html2frame version, playwright-core, system version) and skip the check when
// nothing changed. Nothing is downloaded or opened when something important is missing: a message says what to do.
// For testing the messages: HTML2FRAME_FAKE_NODE=18, HTML2FRAME_FAKE_OS=win32:6.1 or darwin:11.7,
// HTML2FRAME_FAKE_NO_BROWSER=1; HTML2FRAME_PORT=5601 checks another port (to test next to a running panel; start.js then starts the panel on it).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const readline = require('readline');
const {spawnSync, execFileSync} = require('child_process');
const local = require('./local');
const nodeCheck = require('./check-node');
const shortcut = require('./shortcut');
const term = require('./term');

const {ROOT} = local;
const PORT = Number(process.env.HTML2FRAME_PORT) || 5600; // the only address the Figma plugin may load from (figma-plugin/manifest.json)

// ---- the checks -------------------------------------------------------------------------------------
// Each gives {label, ok, detail, fix}: label says what was checked, detail what was found, fix what to do.

function checkOs() {
	const fake = (process.env.HTML2FRAME_FAKE_OS || '').split(':');
	const platform = fake[1] ? fake[0] : process.platform;
	if (platform === 'win32') {
		const release = fake[1] || os.release(); // "10.0.26300"
		const [major, , build] = release.split('.').map(Number);
		const name = major >= 10 ? (build >= 22000 ? 'Windows 11' : 'Windows 10') : 'Windows';
		return {label: 'System', ok: major >= 10, detail: name + ' (' + release + ')', fix: 'html2frame needs Windows 10 or newer.'};
	}
	if (platform === 'darwin') {
		let v = fake[1];
		if (!v) {
			try {
				v = execFileSync('sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim();
			} catch (e) {
				v = '';
			}
		}
		const major = Number(v.split('.')[0]) || 0;
		return {label: 'System', ok: major >= 12, detail: 'macOS ' + (v || os.release()), fix: 'html2frame needs macOS 12 (Monterey) or newer: Microsoft Edge and Google Chrome no longer run on older versions.'};
	}
	return {label: 'System', ok: true, detail: os.type() + ' ' + os.release()};
}

function checkNode() {
	const c = nodeCheck.check();
	return {label: 'Node.js', ok: c.ok, detail: c.version, fix: c.message};
}

function checkFolder() {
	try {
		fs.mkdirSync(local.DIR, {recursive: true});
		const f = local.file('write-test');
		fs.writeFileSync(f, 'ok');
		fs.unlinkSync(f);
		return {label: 'html2frame folder', ok: true, detail: ROOT};
	} catch (e) {
		return {label: 'html2frame folder', ok: false, detail: ROOT, fix: 'html2frame cannot write to its folder. Move the html2frame folder somewhere of your own, e.g. Documents, and start it from there.'};
	}
}

const hasPlaywright = () => fs.existsSync(path.join(ROOT, 'node_modules', 'playwright-core', 'package.json'));

// npm comes with Node.js; its own script is run with this Node, so PATH does not matter
function npmInstall(visible) {
	const dir = path.dirname(process.execPath);
	const cli = [path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(f => fs.existsSync(f));
	const args = ['install', '--omit=dev', '--no-audit', '--no-fund'];
	const opts = {cwd: ROOT, stdio: visible ? 'inherit' : 'ignore', windowsHide: true};
	const r = cli ? spawnSync(process.execPath, [cli].concat(args), opts) : spawnSync('npm', args, Object.assign({shell: true}, opts));
	return r.status === 0;
}

function checkPlaywright(visible) {
	if (!hasPlaywright()) {
		if (visible) console.log(term.dim('       Installing playwright-core (about 14 MB, no browser download)…'));
		npmInstall(visible);
	}
	if (!hasPlaywright()) return {label: 'playwright-core', ok: false, detail: 'not installed', fix: 'Installing it failed. Check the internet connection and start html2frame again.'};
	return {label: 'playwright-core', ok: true, detail: local.readJson(path.join(ROOT, 'node_modules', 'playwright-core', 'package.json'), {}).version};
}

// a real start of the installed Edge or Chrome, the way a capture starts it
async function checkBrowser() {
	const fix = 'html2frame uses Microsoft Edge or Google Chrome, and neither could start. Install one of them (google.com/chrome or microsoft.com/edge), then start html2frame again.';
	if (process.env.HTML2FRAME_FAKE_NO_BROWSER) return {label: 'Browser', ok: false, detail: 'not found', fix};
	if (!hasPlaywright()) return {label: 'Browser', ok: false, detail: 'not checked (playwright-core is missing)', fix};
	const {launchBrowser} = require('./capture');
	let found = '';
	try {
		const browser = await launchBrowser(line => { found = line.replace(/^Browser: /, ''); });
		await browser.close();
		return {label: 'Browser', ok: true, detail: found.replace(/^msedge/, 'Microsoft Edge').replace(/^chrome/, 'Google Chrome')};
	} catch (e) {
		return {label: 'Browser', ok: false, detail: 'not found', fix};
	}
}

// what answers on 127.0.0.1:5600: nothing (free), html2frame (already running) or another program
function probePort() {
	return new Promise(resolve => {
		const req = http.get({host: '127.0.0.1', port: PORT, path: '/api/info', headers: {host: 'localhost:' + PORT}, timeout: 2000}, res => {
			let body = '';
			res.on('data', c => { body += c; });
			res.on('end', () => {
				try {
					resolve(JSON.parse(body).presets ? 'html2frame' : 'other');
				} catch (e) {
					resolve('other');
				}
			});
		});
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', e => resolve(e.code === 'ECONNREFUSED' ? 'free' : 'other'));
	});
}

// the program that listens on the port, e.g. "node.exe (PID 8812)"
function portOwner(port) {
	try {
		if (process.platform === 'win32') {
			const line = execFileSync('netstat', ['-ano', '-p', 'TCP'], {encoding: 'utf8', windowsHide: true}).split(/\r?\n/)
				.find(l => /LISTENING/.test(l) && new RegExp(':' + port + '\\s').test(l));
			const pid = line && line.trim().split(/\s+/).pop();
			if (!pid) return '';
			const csv = execFileSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], {encoding: 'utf8', windowsHide: true});
			const name = (/^"([^"]+)"/.exec(csv.trim()) || [])[1];
			return (name || 'a program') + ' (PID ' + pid + ')';
		}
		const out = execFileSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-Fpc'], {encoding: 'utf8'});
		const pid = (/^p(\d+)/m.exec(out) || [])[1], cmd = (/^c(.+)$/m.exec(out) || [])[1];
		return pid ? (cmd || 'a program') + ' (PID ' + pid + ')' : '';
	} catch (e) {
		return '';
	}
}

async function checkPort() {
	const who = await probePort();
	if (who === 'free') return {label: 'Port ' + PORT, ok: true, detail: 'free'};
	if (who === 'html2frame') return {label: 'Port ' + PORT, ok: true, detail: 'html2frame is already running'};
	const owner = portOwner(PORT) || 'another program';
	return {label: 'Port ' + PORT, ok: false, detail: 'used by ' + owner,
		fix: 'Port ' + PORT + ' is used by ' + owner + '. The Figma plugin can only reach html2frame on port ' + PORT + ': close that program, then start html2frame again.'};
}

// all checks in order; a check that cannot run without an earlier one is skipped when that one failed
async function runChecks({visible = false, onResult = () => {}} = {}) {
	const results = [];
	const add = r => {
		results.push(r);
		onResult(r);
		return r.ok;
	};
	add(checkOs());
	add(checkNode());
	if (add(checkFolder())) {
		if (add(checkPlaywright(visible))) add(await checkBrowser());
	}
	add(await checkPort());
	const check = {checkedAt: new Date().toISOString(), appVersion: local.version(), root: ROOT, os: {platform: process.platform, release: os.release()},
		node: {version: process.versions.node, path: process.execPath}, ok: results.every(r => r.ok), results};
	local.writeJson(local.file('check.json'), check);
	log(results.map(r => (r.ok ? 'ok   ' : 'FAIL ') + r.label + ': ' + r.detail).join('\n'));
	return check;
}

// the saved check still holds when nothing it depends on changed
function stillValid() {
	const c = local.readJson(local.file('check.json'), null);
	return !!(c && c.ok && c.appVersion === local.version() && c.root === ROOT && c.node && c.node.version === process.versions.node
		&& c.node.path === process.execPath && c.os && c.os.release === os.release() && hasPlaywright()
		&& !process.env.HTML2FRAME_FAKE_OS && !process.env.HTML2FRAME_FAKE_NO_BROWSER);
}

function log(text) {
	try {
		fs.mkdirSync(local.DIR, {recursive: true});
		fs.appendFileSync(local.file('setup.log'), '[' + new Date().toISOString() + '] ' + text + '\n');
	} catch (e) {}
}

// ---- icons ------------------------------------------------------------------------------------------

// asked once, each icon separately; Settings changes them later. Enter means yes; when the input ends without an
// answer (no keyboard), the rest is no: nothing is made that nobody asked for.
async function askIcons() {
	if (!shortcut.supported()) return;
	const names = shortcut.names();
	console.log('');
	const rl = readline.createInterface({input: process.stdin, output: process.stdout});
	const lines = [];
	let wake = null, closed = false;
	rl.on('line', l => {
		lines.push(l);
		if (wake) wake();
	});
	rl.on('close', () => {
		closed = true;
		if (wake) wake();
	});
	const icons = {};
	for (const which of names.order) {
		process.stdout.write('  ' + names.question[which] + ' ' + term.dim('[Y/n]') + ' ');
		while (!lines.length && !closed) await new Promise(r => { wake = r; });
		const a = lines.shift();
		if (a === undefined) process.stdout.write('\n');
		icons[which] = a !== undefined && !/^\s*n/i.test(a);
	}
	rl.close();
	const errors = shortcut.apply(icons);
	local.writeState({icons});
	for (const e of errors) console.log('  ' + term.red('[!!]') + ' ' + e);
	log('icons: ' + JSON.stringify(icons) + (errors.length ? ' errors: ' + errors.join('; ') : ''));
}

// ---- start ------------------------------------------------------------------------------------------

// 0: go on and start the panel (start.js does, in this window); 1: something is missing (the message is printed)
async function main() {
	if (stillValid()) {
		log('start (quick: the saved check still holds)');
		return 0;
	}
	console.log('\n  ' + term.brand('html2frame') + ': checking this computer…\n');
	const check = await runChecks({visible: true, onResult: r => console.log('  ' + (r.ok ? term.green('[ok]') : term.red('[!!]')) + ' ' + term.bold(r.label) + ': ' + r.detail)});
	const problems = check.results.filter(r => !r.ok);
	if (problems.length) {
		console.log('\n  ' + term.red(term.bold('html2frame cannot start yet:')) + '\n');
		for (const r of problems) console.log('  ' + term.yellow('- ' + r.fix));
		console.log('');
		return 1;
	}
	if (process.platform === 'darwin') {
		// the ZIP's quarantine flag would make macOS ask again for the icons and after updates
		try {
			execFileSync('xattr', ['-dr', 'com.apple.quarantine', ROOT]);
		} catch (e) {}
	}
	if (!('icons' in local.readState())) await askIcons();
	log('start');
	return 0;
}

module.exports = {main, runChecks, npmInstall};
