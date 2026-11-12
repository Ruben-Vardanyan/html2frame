// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// term.js — a little colour for html2frame's window (the Start file's): standard ANSI colours, which Windows 10+
// (Windows Terminal and the classic console), macOS Terminal and Linux terminals all show. None when the output
// is not a terminal (a log file) or when NO_COLOR is set (https://no-color.org).
'use strict';

const on = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = code => text => (on ? '\x1b[' + code + 'm' + text + '\x1b[0m' : String(text));

module.exports = {
	on,
	bold: paint('1'),
	dim: paint('90'),
	green: paint('32'),
	red: paint('31'),
	yellow: paint('33'),
	brand: paint('1;38;5;39'), // the panel's blue (#0d99ff), bold
	link: paint('4;38;5;39'), // underlined blue: an address
	key: paint('1;38;5;231;48;5;25'), // a key to press: white on dark blue, like a keycap (256-colour codes: the terminal's palette can't make them grey)
};
