// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// trash.js — moves files to the system's recycle bin / Trash (never deletes them), on Windows, macOS and Linux.
// One helper process per call; the paths go in as data (environment or arguments), never into script text.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');

// Windows: the Recycle Bin through .NET (Microsoft.VisualBasic). Paths come one per line in H2F_PATHS.
const TRASH_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName Microsoft.VisualBasic
foreach ($p in ($env:H2F_PATHS -split "\`n")) {
	if (-not $p) { continue }
	try {
		[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
	} catch {
		[Console]::Error.WriteLine($p + ': ' + $_.Exception.Message)
	}
}
`;

// macOS: the Finder moves each file to the Trash (so "Put Back" works). Paths come as arguments.
const TRASH_AS = [
	'on run argv',
	'repeat with p in argv',
	'try',
	'set f to (POSIX file (p as text)) as alias',
	'tell application "Finder" to delete f',
	'on error e',
	'log (p as text) & ": " & e',
	'end try',
	'end repeat',
	'end run',
];

function run(cmd, args, env) {
	return new Promise(resolve => {
		let err = '', done = false;
		const finish = msg => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(msg);
		};
		let child;
		try {
			child = spawn(cmd, args, {env: Object.assign({}, process.env, env || {}), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
		} catch (e) {
			return resolve(e.message);
		}
		// a dialog nobody sees must not hang the panel
		const timer = setTimeout(() => {
			child.kill();
			finish('timed out');
		}, 60000);
		child.stderr.on('data', d => { err += d; });
		child.on('error', e => finish(e.message));
		child.on('close', () => finish(err.trim()));
	});
}

// macOS fallback when the Finder may not be controlled (Automation permission refused): move into ~/.Trash
// under a name that cannot clash (rename would silently replace a file of the same name)
function moveToUserTrash(file) {
	const dir = path.join(os.homedir(), '.Trash');
	const ext = path.extname(file);
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
	const dest = path.join(dir, path.basename(file, ext) + ' ' + stamp + ext);
	try {
		fs.renameSync(file, dest);
	} catch (e) {
		if (e.code !== 'EXDEV') throw e;
		fs.copyFileSync(file, dest); // another volume
		fs.unlinkSync(file);
	}
}

// Moves the files to the Trash. Resolves {removed: [paths], failed: [{file, error}]}; checks each file is really gone.
async function trashFiles(files) {
	files = files.map(f => path.resolve(f)).filter(f => fs.existsSync(f));
	if (!files.length) return {removed: [], failed: []};
	let message = '';
	if (process.platform === 'win32') {
		message = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(TRASH_PS, 'utf16le').toString('base64')], {H2F_PATHS: files.join('\n')});
	} else if (process.platform === 'darwin') {
		message = await run('osascript', TRASH_AS.flatMap(l => ['-e', l]).concat(files));
		for (const f of files) {
			if (!fs.existsSync(f)) continue;
			try {
				moveToUserTrash(f);
			} catch (e) {
				message += '\n' + f + ': ' + e.message;
			}
		}
	} else {
		message = await run('gio', ['trash', '--'].concat(files));
	}
	const removed = files.filter(f => !fs.existsSync(f));
	const failed = files.filter(f => fs.existsSync(f)).map(f => {
		const line = message.split('\n').find(l => l.includes(f));
		return {file: f, error: (line ? line.slice(line.indexOf(f) + f.length).replace(/^:\s*/, '') : message.split('\n')[0]) || 'could not be moved to the Trash'};
	});
	return {removed, failed};
}

module.exports = {trashFiles};
