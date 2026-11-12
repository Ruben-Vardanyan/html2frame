// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// shortcut.js — the html2frame icons (D21), each one only when the user said yes (setup.js asks, Settings changes):
//   Windows: "html2frame" shortcuts on the Desktop and in the Start menu
//   macOS:   html2frame.app in ~/Applications (Launchpad, Spotlight) and a link to it on the Desktop
// An icon opens the Start file, as a double-click on it does: its window shows the check (when needed) and stays
// open while html2frame runs. The macOS app is made here, on this Mac, so it has no quarantine flag and macOS opens
// it without asking (a ready-made app in the ZIP would be blocked as unverified).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const local = require('./local');

const {ROOT} = local;
const NAME = 'html2frame';
const BUNDLE_ID = 'io.github.ruben-vardanyan.html2frame';

const supported = () => process.platform === 'win32' || process.platform === 'darwin';

// the questions and labels, in the order they are asked
function names() {
	if (process.platform === 'darwin') {
		return {order: ['menu', 'desktop'],
			question: {menu: 'Add html2frame to Applications (Launchpad, Spotlight)?', desktop: 'Add an html2frame icon to the Desktop?'},
			label: {menu: 'Applications', desktop: 'Desktop icon'}};
	}
	return {order: ['desktop', 'menu'],
		question: {desktop: 'Add an html2frame icon to the Desktop?', menu: 'Add html2frame to the Start menu?'},
		label: {desktop: 'Desktop icon', menu: 'Start menu'}};
}

// ---- Windows ----------------------------------------------------------------------------------------

// PowerShell, given as -EncodedCommand so no path needs quoting on the command line
function ps(script) {
	return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ProgressPreference = 'SilentlyContinue'; " + script, 'utf16le').toString('base64')],
		{encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}).trim();
}
const psQuote = s => "'" + String(s).replace(/'/g, "''") + "'";

let winDirs = null;
// the real Desktop and Start menu folders (the Desktop may be redirected, e.g. to OneDrive)
function winFolders() {
	if (!winDirs) {
		const [desktop, programs] = ps("[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('Programs')").split(/\r?\n/);
		winDirs = {desktop: path.join(desktop, NAME + '.lnk'), menu: path.join(programs, NAME + '.lnk')};
	}
	return winDirs;
}

// the shortcut opens the Start file in its window, with the html2frame icon
function winCreate(file) {
	ps([
		'$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + psQuote(file) + ')',
		'$s.TargetPath = ' + psQuote(path.join(ROOT, 'Start (Windows).bat')),
		'$s.WorkingDirectory = ' + psQuote(ROOT),
		'$s.IconLocation = ' + psQuote(path.join(ROOT, 'assets', 'icon.ico') + ',0'),
		"$s.Description = 'html2frame: web pages to editable Figma frames'",
		'$s.WindowStyle = 1',
		'$s.Save()',
	].join('; '));
}

// only html2frame's shortcut is removed: one that opens the Start file (or, from before, runs start.js)
function winRemove(file) {
	if (!fs.existsSync(file)) return;
	ps('$p = ' + psQuote(file) + "; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($p); if ($s.TargetPath -like '*Start (Windows).bat' -or $s.Arguments -like '*start.js*') { Remove-Item -LiteralPath $p }");
}

// ---- macOS ------------------------------------------------------------------------------------------

const macApps = () => path.join(os.homedir(), 'Applications', NAME + '.app');
const macLocal = () => path.join(local.DIR, NAME + '.app'); // the app behind a Desktop icon when Applications was declined
const macDesktop = () => path.join(os.homedir(), 'Desktop', NAME);
const bashQuote = s => '"' + String(s).replace(/(["$`\\])/g, '\\$1') + '"';

const isOurApp = app => {
	try {
		return fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8').includes(BUNDLE_ID);
	} catch (e) {
		return false;
	}
};

function macWriteApp(app) {
	if (fs.existsSync(app) && !isOurApp(app)) throw new Error(app + ' exists and is not html2frame\'s; it was left as it is.');
	const contents = path.join(app, 'Contents');
	fs.mkdirSync(path.join(contents, 'MacOS'), {recursive: true});
	fs.mkdirSync(path.join(contents, 'Resources'), {recursive: true});
	fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>html2frame</string>
	<key>CFBundleDisplayName</key><string>html2frame</string>
	<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
	<key>CFBundleExecutable</key><string>html2frame</string>
	<key>CFBundleIconFile</key><string>icon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>${local.version()}</string>
	<key>LSUIElement</key><true/>
</dict>
</plist>
`);
	// the app opens the Start file in Terminal, as a double-click on it does
	const exe = path.join(contents, 'MacOS', 'html2frame');
	fs.writeFileSync(exe, `#!/bin/bash
# html2frame: opens the Start file in Terminal (made on this Mac by html2frame's setup, D21)
exec open ${bashQuote(path.join(ROOT, 'Start (macOS).command'))}
`);
	fs.chmodSync(exe, 0o755);
	fs.copyFileSync(path.join(ROOT, 'assets', 'icon.icns'), path.join(contents, 'Resources', 'icon.icns'));
	const now = new Date();
	fs.utimesSync(app, now, now); // Finder then shows the new icon
}

function macRemoveApp(app) {
	if (isOurApp(app)) fs.rmSync(app, {recursive: true, force: true});
}

// the Desktop icon: a link to the app (Finder shows the app's icon with a small arrow)
function macLink(target) {
	const link = macDesktop();
	try {
		if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
		else throw new Error(link + ' exists and is not html2frame\'s; it was left as it is.');
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
	}
	if (target) fs.symlinkSync(target, link);
}

// ---- both -------------------------------------------------------------------------------------------

// which icons exist now
function status() {
	if (process.platform === 'win32') {
		try {
			const f = winFolders();
			return {desktop: fs.existsSync(f.desktop), menu: fs.existsSync(f.menu)};
		} catch (e) {
			return {desktop: false, menu: false};
		}
	}
	if (process.platform === 'darwin') {
		let desktop = false;
		try {
			desktop = fs.lstatSync(macDesktop()).isSymbolicLink() && fs.existsSync(macDesktop());
		} catch (e) {}
		return {desktop, menu: isOurApp(macApps())};
	}
	return {desktop: false, menu: false};
}

// makes the icons match {desktop, menu}; a key that is missing is left as it is. Returns the problems, if any.
function apply(want) {
	const errors = [];
	const now = status();
	const wish = {desktop: 'desktop' in want ? !!want.desktop : now.desktop, menu: 'menu' in want ? !!want.menu : now.menu};
	const step = fn => {
		try {
			fn();
		} catch (e) {
			errors.push(String(e.message || e).split('\n')[0]);
		}
	};
	if (process.platform === 'win32') {
		for (const which of ['desktop', 'menu']) step(() => (wish[which] ? winCreate(winFolders()[which]) : winRemove(winFolders()[which])));
	} else if (process.platform === 'darwin') {
		step(() => (wish.menu ? macWriteApp(macApps()) : macRemoveApp(macApps())));
		step(() => {
			if (wish.desktop && !wish.menu) macWriteApp(macLocal());
			macLink(wish.desktop ? (wish.menu ? macApps() : macLocal()) : null);
			if (!wish.desktop || wish.menu) macRemoveApp(macLocal());
		});
	}
	return errors;
}

module.exports = {supported, names, status, apply};
