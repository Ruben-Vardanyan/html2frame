// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)
// help.js — the Help page: Windows / macOS instructions, the plugin's manifest path (copy, show in folder: common.js).
'use strict';

function showOs(os) {
	document.querySelectorAll('[data-os]').forEach(x => { x.hidden = x.dataset.os !== os; });
	document.querySelectorAll('#osSwitch input').forEach(r => { r.checked = r.value === os; });
}

document.querySelectorAll('#osSwitch input').forEach(r => r.addEventListener('change', () => showOs(r.value)));
showOs(/Mac/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'win');

// the problems: one answer open at a time, opening and closing with a short slide. Without this script the
// browser still keeps one open (<details name="faq">), only without the slide; the script takes it over so that the
// one it closes slides too.
(function () {
	const all = [...document.querySelectorAll('#faq details')];
	const still = matchMedia('(prefers-reduced-motion: reduce)');
	const running = new Map(); // details → its animation
	function slide(d, open) {
		const a = d.querySelector('.answer');
		if (running.has(d)) running.get(d).cancel();
		// no slide for reduced motion, or in a hidden tab (its animations do not run)
		if (still.matches || document.hidden) {
			d.open = open;
			return;
		}
		if (open) d.open = true;
		const cs = getComputedStyle(a);
		const full = {height: a.offsetHeight + 'px', paddingBottom: cs.paddingBottom, opacity: 1};
		const none = {height: '0px', paddingBottom: '0px', opacity: 0};
		const duration = open ? 220 : 180;
		const anim = a.animate(open ? [none, full] : [full, none], {duration, easing: open ? 'ease-out' : 'ease-in'});
		running.set(d, anim);
		// the end, once: when the slide finishes, or by a timer should the animation not run at all
		const end = () => {
			if (running.get(d) !== anim) return;
			running.delete(d);
			anim.cancel();
			if (!open) d.open = false;
		};
		anim.onfinish = end;
		setTimeout(end, duration + 80);
	}
	for (const d of all) {
		d.removeAttribute('name'); // the browser would close the others at once; slide() closes them
		d.querySelector('summary').addEventListener('click', e => {
			e.preventDefault(); // Enter and Space on the question come here too
			// open (or opening): close it; closing: open it again
			if (d.open) return slide(d, running.has(d) && !wasOpening(d));
			for (const o of all) if (o !== d && o.open) slide(o, false);
			slide(d, true);
		});
	}
	// a click during a slide reverses it
	function wasOpening(d) {
		const anim = running.get(d);
		const kf = anim && anim.effect.getKeyframes();
		return !!kf && kf[0].height === '0px';
	}
})();

// the sidebar marks the section being read: the last one whose top has passed a line a third down the window
(function () {
	const links = [...document.querySelectorAll('.help-nav a[href^="#"]')];
	const targets = links.map(a => document.getElementById(a.getAttribute('href').slice(1)));
	function mark() {
		const line = innerHeight / 3;
		let current = 0;
		targets.forEach((t, i) => { if (t && t.getBoundingClientRect().top <= line) current = i; });
		// at the very bottom the last section counts, even when it is too short to reach the line
		if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = targets.length - 1;
		links.forEach((a, i) => (i === current ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
	}
	addEventListener('scroll', mark, {passive: true});
	addEventListener('resize', mark);
	mark();
})();

(async () => {
	try {
		const info = await call('GET', '/api/info');
		manifestBlock(info.pluginManifest);
		showUpdateDot(info.updateAvailable);
		if (info.platform === 'darwin') showOs('mac');
		else if (info.platform === 'win32') showOs('win');
		if (info.port !== 5600) {
			$('portWarning').hidden = false;
			$('portWarning').closest('details').open = true; // the answer it belongs to
			$('portWarning').textContent = 'This panel runs on port ' + info.port + ', so the plugin cannot reach it: start it on 5600 (the default).';
		}
	} catch (e) {
		manifestBlock(null);
	}
})();
