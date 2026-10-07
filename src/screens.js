// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// screens.js — screen presets and orientation handling.
// Sizes are CSS pixels in portrait/landscape order as the device is usually held.

const PRESETS = {
	'desktop-hd': {label: 'Desktop HD', width: 1920, height: 1080, mobile: false},
	'desktop': {label: 'Desktop', width: 1440, height: 900, mobile: false},
	'laptop': {label: 'Laptop', width: 1280, height: 800, mobile: false},
	'laptop-sm': {label: 'Laptop small', width: 1366, height: 768, mobile: false},
	'tablet-lg': {label: 'Tablet large', width: 1024, height: 1366, mobile: true},
	'tablet': {label: 'Tablet', width: 768, height: 1024, mobile: true},
	'phone': {label: 'Phone', width: 390, height: 844, mobile: true},
	'phone-sm': {label: 'Phone small', width: 360, height: 780, mobile: true},
};

// Desktops and laptops only exist in landscape; phones and tablets come in both.
function orientationsFor(preset, wanted) {
	if (!preset.mobile) return ['landscape'];
	if (wanted === 'both') return ['portrait', 'landscape'];
	return [wanted === 'landscape' ? 'landscape' : 'portrait'];
}

// screens: ["desktop", "phone", {name, width, height, mobile?}] ; orientation: portrait | landscape | both
function resolveScreens(screens, orientation) {
	const list = [];
	for (const s of screens && screens.length ? screens : ['desktop']) {
		if (typeof s === 'object') {
			const id = (s.name || 'custom').toLowerCase().replace(/\s+/g, '-');
			list.push({
				id, preset: id,
				label: s.name || 'Custom', width: s.width, height: s.height || 900,
				mobile: !!s.mobile, orientation: s.width > (s.height || 900) ? 'landscape' : 'portrait',
			});
			continue;
		}
		const [key, forced] = String(s).split(':'); // "phone:landscape" forces one orientation
		const preset = PRESETS[key];
		if (!preset) throw new Error('Unknown screen "' + s + '". Use one of: ' + Object.keys(PRESETS).join(', ') + ', or {name, width, height}.');
		for (const o of orientationsFor(preset, forced || orientation || 'portrait')) {
			const short = Math.min(preset.width, preset.height), long = Math.max(preset.width, preset.height);
			const [width, height] = preset.mobile ? (o === 'portrait' ? [short, long] : [long, short]) : [preset.width, preset.height];
			list.push({
				id: key + (preset.mobile ? '-' + o : ''), preset: key, // preset: "phone" for both orientations
				label: preset.label + (preset.mobile ? ' ' + o : ''),
				width, height, mobile: preset.mobile, orientation: o,
			});
		}
	}
	return list;
}

module.exports = {PRESETS, resolveScreens};
