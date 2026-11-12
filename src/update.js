// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// update.js — the update check and the one-click update (D21). Self-contained (Node's own modules only): to replace
// the program files, a copy of this file runs from .html2frame/update/ after the panel server has quit.
//
// Updates come from GitHub Releases: only a release the owner published counts, never work merged to main in
// between. The check reads the latest release (its tag, e.g. v0.3.0, is the version; its notes are "What's new").
// ZIP install: "Update now" downloads that release's ZIP, extracts it with the system's own tool (Windows tar, macOS
// ditto), checks it is that version, then the copy of this file backs up the program files to .html2frame/backup/<old version>/,
// copies the new ones in, removes the files the new version no longer has (from the previous update's list,
// .html2frame/files.json), runs npm install when the dependencies changed, and restarts the panel. Any error puts
// the backup back and restarts the old version. projects/, captures/, .html2frame/, node_modules/ and .git/ are
// never touched.
// Git install (a .git folder): `git fetch --tags`, then `git merge --ff-only <tag>`, only when it is safe: on branch
// main, no changed tracked files, and no local commits that the release does not have. Otherwise nothing is changed
// and the panel shows why and the command.
// HTML2FRAME_RELEASE_API=<url> reads the "latest release" from another address (to test an update without
// publishing a release); the answer has GitHub's shape: {tag_name, body, html_url, published_at, zipball_url}.
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const {spawn, spawnSync, execFileSync} = require('child_process');

const REPO = 'Ruben-Vardanyan/html2frame';
const BRANCH = 'main';
const RELEASE_API = process.env.HTML2FRAME_RELEASE_API || 'https://api.github.com/repos/' + REPO + '/releases/latest';
const RELEASES_PAGE = 'https://github.com/' + REPO + '/releases';
const KEEP = ['projects/', 'captures/', '.html2frame/', 'node_modules/', '.git/']; // never replaced or removed
const WEEK = 7 * 24 * 3600 * 1000;

// ---- small helpers (no requires from the program folder) --------------------------------------------

const dirOf = root => path.join(root, '.html2frame');

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

const statePath = root => path.join(dirOf(root), 'state.json');
const readState = root => readJson(statePath(root), {});
function writeState(root, patch) {
	const s = Object.assign(readState(root), patch);
	for (const k of Object.keys(patch)) if (patch[k] === undefined) delete s[k];
	writeJson(statePath(root), s);
	return s;
}

const versionOf = dir => readJson(path.join(dir, 'package.json'), {}).version || '0.0.0';

function newer(a, b) {
	const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
	}
	return false;
}

const installKind = root => (fs.existsSync(path.join(root, '.git')) ? 'git' : 'zip');

function git(root, args, timeout = 60000) {
	return execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true, timeout, stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

const manualCommand = (root, tag) => (process.platform === 'win32' ? 'cd /d "' + root + '"' : 'cd "' + root + '"') + ' && git fetch --tags origin && git merge --ff-only ' + (tag || '<the release tag>');

// can the folder move to the release without touching anybody's work? {ok, reason}
function gitSafety(root, tag) {
	try {
		git(root, ['--version'], 10000);
	} catch (e) {
		return {ok: false, reason: 'Git is not installed, or not on the PATH.'};
	}
	try {
		const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
		if (branch !== BRANCH) return {ok: false, reason: 'This folder is on the branch "' + branch + '", not "' + BRANCH + '".'};
		if (git(root, ['status', '--porcelain', '--untracked-files=no'])) return {ok: false, reason: 'Some files of html2frame were changed in this folder.'};
		if (tag) {
			try {
				git(root, ['rev-parse', '--verify', '--quiet', tag + '^{commit}']);
			} catch (e) {
				return {ok: false, reason: 'The release ' + tag + ' is not in this folder yet (git fetch --tags did not bring it).'};
			}
			// HEAD must be an ancestor of the release: then moving to it only adds commits
			const r = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', tag], {cwd: root, windowsHide: true});
			if (r.status !== 0) return {ok: false, reason: 'This folder has commits that the release ' + tag + ' does not have.'};
		}
		return {ok: true};
	} catch (e) {
		return {ok: false, reason: 'Git could not read this folder: ' + String(e.message).split('\n')[0]};
	}
}

// ---- check ------------------------------------------------------------------------------------------

// the latest published release on GitHub (drafts and pre-releases do not count); null when none is published yet
async function latestRelease() {
	const res = await fetch(RELEASE_API, {signal: AbortSignal.timeout(20000), headers: {accept: 'application/vnd.github+json', 'user-agent': 'html2frame'}});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error('GitHub answered ' + res.status);
	const r = await res.json();
	const tag = String(r.tag_name || '');
	if (!/^v?\d+\.\d+\.\d+/.test(tag)) throw new Error('the latest release has no version tag (' + (tag || 'none') + ')');
	return {tag, version: tag.replace(/^v/i, ''), notes: String(r.body || '').slice(0, 5000), url: r.html_url || RELEASES_PAGE, published: r.published_at || null, zip: r.zipball_url};
}

// the newest release; saves it (with the time and, for git, whether the folder can move to it) in state.json
async function check(root) {
	const kind = installKind(root);
	try {
		const release = await latestRelease();
		if (release && kind === 'git') git(root, ['fetch', '--quiet', '--tags', 'origin'], 120000);
		return writeState(root, {lastUpdateCheck: new Date().toISOString(), updateCheckError: undefined, latestVersion: release ? release.version : undefined,
			release: release || undefined, noRelease: release ? undefined : true, gitSafety: kind === 'git' ? gitSafety(root, release && release.tag) : undefined});
	} catch (e) {
		return writeState(root, {lastUpdateCheck: new Date().toISOString(), updateCheckError: 'Could not check for updates: ' + String(e.message || e).split('\n')[0]});
	}
}

const checkDue = root => {
	const t = Date.parse(readState(root).lastUpdateCheck || '');
	return !(t > Date.now() - WEEK);
};

// what the Settings page shows about updates
function info(root) {
	const s = readState(root), version = versionOf(root), kind = installKind(root);
	const rel = s.release || null;
	return {version, install: kind, latest: s.latestVersion || null, lastCheck: s.lastUpdateCheck || null, checkError: s.updateCheckError || null,
		noRelease: !!s.noRelease, release: rel && {tag: rel.tag, notes: rel.notes, url: rel.url, published: rel.published},
		available: !!s.latestVersion && newer(s.latestVersion, version), git: kind === 'git' ? Object.assign({command: manualCommand(root, rel && rel.tag)}, s.gitSafety || {}) : null,
		updated: s.updated || null, error: s.updateError || null};
}

// ---- prepare (in the panel server, as a job with progress) ------------------------------------------

function listFiles(dir, base = dir, out = []) {
	for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
		const f = path.join(dir, e.name);
		if (e.isDirectory()) listFiles(f, base, out);
		else if (e.isFile()) out.push(path.relative(base, f).split(path.sep).join('/'));
	}
	return out;
}

function extract(zip, into) {
	fs.mkdirSync(into, {recursive: true});
	// Windows' own tar (bsdtar, Windows 10 1803+) reads zip; Git Bash's tar on the PATH does not, hence the full path
	const [cmd, args] = process.platform === 'win32' ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', into]]
		: process.platform === 'darwin' ? ['ditto', ['-x', '-k', zip, into]] : ['unzip', ['-q', zip, '-d', into]];
	const r = spawnSync(cmd, args, {windowsHide: true, encoding: 'utf8'});
	if (r.status !== 0) throw new Error('Could not extract the download: ' + String(r.stderr || (r.error && r.error.message) || '').split('\n')[0]);
}

// emit(type, data) as the server's jobs: 'log' {text}, 'progress' {done, total, label}
async function prepare(root, emit, signal) {
	const kind = installKind(root);
	const log = text => emit('log', {text});
	log('Looking for the latest release…');
	await check(root);
	const s = readState(root);
	if (s.updateCheckError) throw new Error(s.updateCheckError);
	const rel = s.release;
	if (!rel) throw new Error('No release has been published on GitHub yet. Nothing was changed.');
	if (!newer(rel.version, versionOf(root))) throw new Error('This is already the newest version (' + versionOf(root) + ').');
	if (kind === 'git') {
		const safety = gitSafety(root, rel.tag);
		if (!safety.ok) throw new Error(safety.reason + ' Update it yourself: ' + manualCommand(root, rel.tag));
		log('Ready: move to the release ' + rel.tag + '.');
		return {mode: 'git', version: rel.version, tag: rel.tag};
	}
	const work = path.join(dirOf(root), 'update');
	fs.rmSync(work, {recursive: true, force: true});
	fs.mkdirSync(work, {recursive: true});
	log('Downloading release ' + rel.tag + ' …');
	const res = await fetch(rel.zip, {signal, headers: {'user-agent': 'html2frame'}});
	if (!res.ok) throw new Error('The download failed: GitHub answered ' + res.status);
	const total = Number(res.headers.get('content-length')) || 0;
	const zip = path.join(work, 'html2frame.zip');
	const out = fs.createWriteStream(zip);
	let done = 0;
	for await (const chunk of res.body) {
		if (signal.aborted) throw new Error('Cancelled');
		done += chunk.length;
		if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
		emit('progress', {done, total, label: 'Downloading… ' + (done / 1048576).toFixed(1) + ' MB' + (total ? ' of ' + (total / 1048576).toFixed(1) + ' MB' : '')});
	}
	await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
	log('Downloaded ' + (done / 1048576).toFixed(1) + ' MB. Extracting…');
	emit('progress', {done: 1, total: 1, label: 'Extracting…'});
	extract(zip, path.join(work, 'new'));
	// the ZIP holds one folder (GitHub names it after the repository and the commit)
	const top = fs.readdirSync(path.join(work, 'new'), {withFileTypes: true}).filter(e => e.isDirectory());
	const from = top.length === 1 ? path.join(work, 'new', top[0].name) : path.join(work, 'new');
	for (const need of ['package.json', 'server.js', 'panel', 'src', 'figma-plugin']) {
		if (!fs.existsSync(path.join(from, need))) throw new Error('The download does not look like html2frame (no ' + need + '). Nothing was changed.');
	}
	const version = versionOf(from);
	if (version !== rel.version) throw new Error('The release ' + rel.tag + ' holds version ' + version + ' in its package.json, not ' + rel.version + '. Nothing was changed.');
	log('Checked: version ' + version + '.');
	return {mode: 'zip', from, version};
}

// starts the copy of this file that replaces the program files once the server has quit (the caller then quits)
function launchApply(root, prepared, port) {
	const runner = path.join(dirOf(root), 'update', 'update.js');
	fs.mkdirSync(path.dirname(runner), {recursive: true});
	fs.copyFileSync(__filename, runner);
	const job = Object.assign({root, port, node: process.execPath, oldVersion: versionOf(root)}, prepared);
	spawn(process.execPath, [runner, '--apply', JSON.stringify(job)], {cwd: os.tmpdir(), detached: true, stdio: 'ignore', windowsHide: true}).unref();
}

// ---- apply (the copy in .html2frame/update/, after the server quit) ---------------------------------

function waitPortFree(port, ms) {
	const until = Date.now() + ms;
	return new Promise(resolve => {
		const tryOnce = () => {
			const s = net.connect({host: '127.0.0.1', port});
			s.on('connect', () => {
				s.destroy();
				if (Date.now() > until) resolve(false);
				else setTimeout(tryOnce, 300);
			});
			s.on('error', () => resolve(true));
		};
		tryOnce();
	});
}

function npmInstall(root, node) {
	const dir = path.dirname(node);
	const cli = [path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(f => fs.existsSync(f));
	const args = ['install', '--omit=dev', '--no-audit', '--no-fund'];
	const r = cli ? spawnSync(node, [cli].concat(args), {cwd: root, windowsHide: true, encoding: 'utf8'}) : spawnSync('npm', args, {cwd: root, shell: true, windowsHide: true, encoding: 'utf8'});
	if (r.status !== 0) throw new Error('npm install failed: ' + String(r.stderr || '').trim().split('\n').pop());
}

const kept = f => KEEP.some(k => f.startsWith(k));
const depsOf = dir => JSON.stringify(readJson(path.join(dir, 'package.json'), {}).dependencies || {});

// HTML2FRAME_FAKE_UPDATE_FAIL=src/x.js makes copying that file fail, to test putting the old version back
function copyFile(src, dst) {
	if (process.env.HTML2FRAME_FAKE_UPDATE_FAIL && dst.split(path.sep).join('/').endsWith('/' + process.env.HTML2FRAME_FAKE_UPDATE_FAIL) && !src.includes(path.sep + 'backup' + path.sep)) {
		throw new Error('Test failure on ' + process.env.HTML2FRAME_FAKE_UPDATE_FAIL);
	}
	fs.mkdirSync(path.dirname(dst), {recursive: true});
	try {
		fs.chmodSync(dst, 0o666); // a read-only file (Windows) would stop the copy
	} catch (e) {}
	fs.copyFileSync(src, dst);
	fs.chmodSync(dst, fs.statSync(src).mode & 0o777); // keeps "Start (macOS).command" executable
}

function applyZip(job, log) {
	const {root, from} = job;
	const dir = dirOf(root);
	const newFiles = listFiles(from).filter(f => !kept(f));
	const oldList = readJson(path.join(dir, 'files.json'), null);
	const gone = oldList ? oldList.filter(f => !kept(f) && !newFiles.includes(f)) : [];
	const oldDeps = depsOf(root);
	const backup = path.join(dir, 'backup', job.oldVersion);
	fs.rmSync(path.join(dir, 'backup'), {recursive: true, force: true});
	const saved = [], added = [];
	try {
		for (const f of newFiles.concat(gone)) {
			if (fs.existsSync(path.join(root, f))) {
				copyFile(path.join(root, f), path.join(backup, f));
				saved.push(f);
			}
		}
		log('Backed up ' + saved.length + ' files to ' + backup);
		for (const f of newFiles) {
			if (!fs.existsSync(path.join(root, f))) added.push(f);
			copyFile(path.join(from, f), path.join(root, f));
		}
		for (const f of gone) fs.rmSync(path.join(root, f), {force: true});
		log('Copied ' + newFiles.length + ' files, removed ' + gone.length + '.');
		if (depsOf(root) !== oldDeps) {
			log('The dependencies changed: npm install…');
			npmInstall(root, job.node);
		}
		writeJson(path.join(dir, 'files.json'), newFiles);
	} catch (e) {
		// every file on its own: one that cannot be put back does not stop the others
		log('Failed: ' + e.message + '. Putting the old version back…');
		const stuck = [];
		const undo = (f, fn) => {
			try {
				fn();
			} catch (e2) {
				stuck.push(f);
			}
		};
		for (const f of saved) undo(f, () => copyFile(path.join(backup, f), path.join(root, f)));
		for (const f of added) undo(f, () => fs.rmSync(path.join(root, f), {force: true}));
		if (depsOf(root) !== oldDeps) undo('node_modules', () => npmInstall(root, job.node));
		if (stuck.length) {
			log('Could not put back: ' + stuck.join(', ') + ' (the old files are in ' + backup + ')');
			e.message += ' Some files could not be put back; the old ones are in ' + backup + '.';
		} else log('The old version is back.');
		throw e;
	}
}

function applyGit(job, log) {
	const {root} = job;
	git(root, ['fetch', '--quiet', '--tags', 'origin'], 300000);
	const safety = gitSafety(root, job.tag);
	if (!safety.ok) throw new Error(safety.reason);
	const before = git(root, ['rev-parse', 'HEAD']);
	const oldDeps = depsOf(root);
	log(git(root, ['merge', '--ff-only', job.tag], 300000));
	try {
		if (depsOf(root) !== oldDeps) {
			log('The dependencies changed: npm install…');
			npmInstall(root, job.node);
		}
	} catch (e) {
		// the folder was clean before the merge (gitSafety), so going back loses nothing
		log('Failed: ' + e.message + '. Going back to ' + before.slice(0, 7) + '…');
		git(root, ['reset', '--hard', before]);
		throw e;
	}
}

async function apply(job) {
	const {root} = job;
	const logFile = path.join(dirOf(root), 'logs', 'update.log');
	fs.mkdirSync(path.dirname(logFile), {recursive: true});
	const log = text => fs.appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + text + '\n');
	log('Update ' + job.oldVersion + ' → ' + job.version + ' (' + job.mode + ')');
	try {
		if (!(await waitPortFree(job.port, 30000))) throw new Error('The panel did not stop, so nothing was changed.');
		if (job.mode === 'git') applyGit(job, log);
		else applyZip(job, log);
		writeState(root, {updated: {from: job.oldVersion, to: versionOf(root), at: new Date().toISOString()}, updateError: undefined});
		log('Done: version ' + versionOf(root));
	} catch (e) {
		writeState(root, {updateError: {to: job.version, message: String(e.message || e), at: new Date().toISOString()}});
		log('Error: ' + (e.stack || e));
	}
	// the panel starts again (the new version, or the old one after an error) the way a click on the Start file starts
	// it: in its own window, after the setup check (the version changed). An open Settings page reconnects; the server
	// opens no second tab then (server.js, listen). On Linux, or on a test port, it starts without a window.
	const env = Object.assign({}, process.env, job.port === 5600 ? {} : {HTML2FRAME_PORT: String(job.port)});
	if (process.platform === 'win32' && job.port === 5600) {
		spawn('cmd.exe', ['/c', 'start', '""', '"' + path.join(root, 'Start (Windows).bat') + '"'], {cwd: root, env, windowsVerbatimArguments: true, detached: true, stdio: 'ignore'}).unref();
	} else if (process.platform === 'darwin' && job.port === 5600) {
		spawn('open', [path.join(root, 'Start (macOS).command')], {cwd: root, env, detached: true, stdio: 'ignore'}).unref();
	} else {
		const port = job.port === 5600 ? [] : ['--port', String(job.port)];
		spawn(job.node, [path.join(root, 'server.js'), '--log'].concat(port), {cwd: root, detached: true, stdio: 'ignore', windowsHide: true}).unref();
	}
	if (job.mode === 'zip') fs.rmSync(path.join(dirOf(root), 'update', 'new'), {recursive: true, force: true});
}

if (require.main === module && process.argv[2] === '--apply') apply(JSON.parse(process.argv[3]));

module.exports = {installKind, check, checkDue, info, prepare, launchApply, newer};
