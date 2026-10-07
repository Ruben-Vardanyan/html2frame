// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// steps.js — runs a list of steps (goto, click, fill, …) on a Playwright page.
// Used for account logins and for page states (D5, D8). Vocabulary: docs/PLAN.md "Steps vocabulary".

// Resolve a site path against the origin and merge the variant's query parameters.
function resolveUrl(p, {origin, query}) {
	const url = new URL(p, origin + '/');
	for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
	return url.href;
}

async function gotoPath(page, p, ctx) {
	await page.goto(resolveUrl(p, ctx), {waitUntil: 'load'});
}

// Click, and if that started a main-frame navigation, wait for the new page to load.
async function clickAndWait(page, sel) {
	const nav = page.waitForEvent('framenavigated', {predicate: f => f === page.mainFrame(), timeout: 1500}).then(() => true, () => false);
	await page.click(sel);
	if (await nav) await page.waitForLoadState('load');
}

async function selectOption(page, sel, value) {
	try {
		await page.selectOption(sel, value, {timeout: 2000});
	} catch (e) {
		await page.selectOption(sel, {label: value});
	}
}

const ACTIONS = {
	goto: (page, s, ctx) => gotoPath(page, s.goto, ctx),
	click: (page, s) => clickAndWait(page, s.click),
	fill: (page, s) => page.fill(s.fill, String(s.value ?? '')),
	select: (page, s) => selectOption(page, s.select, String(s.value ?? '')),
	check: (page, s) => page.check(s.check),
	press: (page, s) => (s.on ? page.press(s.on, s.press) : page.keyboard.press(s.press)),
	hover: (page, s) => page.hover(s.hover),
	wait: (page, s) => page.waitForTimeout(Number(s.wait) || 0),
	waitFor: (page, s) => page.waitForSelector(s.waitFor, {state: 'visible'}),
	waitForUrl: (page, s) => page.waitForURL(u => u.href.includes(s.waitForUrl)),
	// indirect eval runs in global scope; a returned promise is awaited by evaluate
	eval: (page, s) => page.evaluate(js => (0, eval)(js), s.eval),
	reload: page => page.reload({waitUntil: 'load'}),
};

function stepKind(step) {
	return Object.keys(step || {}).find(k => ACTIONS[k]);
}

async function runSteps(page, steps, ctx) {
	for (let i = 0; i < (steps || []).length; i++) {
		const step = steps[i];
		const kind = stepKind(step);
		if (!kind) throw new Error('Step ' + (i + 1) + ' ' + JSON.stringify(step) + ': unknown step. Use one of: ' + Object.keys(ACTIONS).join(', '));
		try {
			await ACTIONS[kind](page, step, ctx);
		} catch (e) {
			throw new Error('Step ' + (i + 1) + ' ' + JSON.stringify(step) + ': ' + String(e && e.message || e).split('\n')[0]);
		}
	}
}

module.exports = {resolveUrl, gotoPath, runSteps, stepKind};
