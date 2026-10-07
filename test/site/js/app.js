// Fixture — test site for html2frame. Like real sites, much of the page is drawn by JavaScript:
// header, footer, product cards, translations. The page is hidden (html.loading) until everything is
// rendered, then <html data-ready="yes"> is set: the capture's `readyWhen` waits for it.
//
// Variants the capture can switch:
//   language  localStorage "fixture.lang" = "en" | "hy", or ?lang=hy in the URL (the URL wins)
//   theme     cookie "theme=dark"
//   login     localStorage "fixture.session" (any e-mail and password log in; nothing is checked)
(function () {
	const params = new URLSearchParams(location.search);
	const lang = params.get('lang') || localStorage.getItem('fixture.lang') || 'en';
	const theme = (document.cookie.match(/(?:^|;\s*)theme=([^;]+)/) || [])[1] || 'light';
	document.documentElement.lang = lang === 'hy' ? 'hy' : 'en';
	document.documentElement.dataset.theme = theme;

	const T = {
		en: {
			'nav.home': 'Home', 'nav.type': 'Typography', 'nav.boxes': 'Boxes', 'nav.images': 'Images', 'nav.forms': 'Forms', 'nav.edge': 'Edge cases',
			'nav.signin': 'Sign in', 'nav.account': 'Account', 'nav.cart': 'Cart',
			'hero.badge': 'New season · Free delivery', 'hero.title': 'Objects that make a home feel calm',
			'hero.text': 'Hand-picked lamps, planters and textiles from small studios. Designed to last, priced fairly.',
			'hero.shop': 'Shop the collection', 'hero.more': 'Read our story',
			'features.eyebrow': 'Why Fixture', 'features.title': 'Small details, done properly',
			'f1.t': 'Fast delivery', 'f1.d': 'Orders before 2 pm leave the same day, across the country.',
			'f2.t': 'Safe payment', 'f2.d': 'Cards, bank transfer or cash on delivery — your choice.',
			'f3.t': 'Made to last', 'f3.d': 'Every product is tested for a year before it reaches the shop.',
			'f4.t': 'Easy returns', 'f4.d': 'Changed your mind? Send it back within 30 days, no questions.',
			'products.eyebrow': 'Best sellers', 'products.title': 'Popular this week', 'products.all': 'View all products',
			'quote.text': 'The lamp arrived in two days, beautifully packed. It is the first thing guests ask about.',
			'band.title': 'Get 10% off your first order', 'band.text': 'One e-mail a month. No spam, ever.', 'band.cta': 'Subscribe', 'band.ph': 'Your e-mail address',
			'footer.about': 'A tiny shop that exists only to test html2frame. Nothing here is for sale.', 'footer.shop': 'Shop', 'footer.help': 'Help', 'footer.company': 'Company',
			'buy': 'Add to cart', 'reviews': 'reviews', 'stock': 'In stock',
		},
		hy: {
			'nav.home': 'Գլխավոր', 'nav.type': 'Տառատեսակ', 'nav.boxes': 'Տուփեր', 'nav.images': 'Նկարներ', 'nav.forms': 'Ձևեր', 'nav.edge': 'Եզրային դեպքեր',
			'nav.signin': 'Մուտք', 'nav.account': 'Հաշիվ', 'nav.cart': 'Զամբյուղ',
			'hero.badge': 'Նոր սեզոն · Անվճար առաքում', 'hero.title': 'Իրեր, որոնք տունը հանգիստ են դարձնում',
			'hero.text': 'Ընտրված լամպեր, ծաղկամաններ և տեքստիլ փոքր արհեստանոցներից։ Երկարակյաց և արդար գնով։',
			'hero.shop': 'Դիտել հավաքածուն', 'hero.more': 'Մեր պատմությունը',
			'features.eyebrow': 'Ինչու Fixture', 'features.title': 'Փոքր մանրուքներ՝ ճիշտ արված',
			'f1.t': 'Արագ առաքում', 'f1.d': 'Մինչև 14:00 պատվերները ճանապարհվում են նույն օրը։',
			'f2.t': 'Անվտանգ վճարում', 'f2.d': 'Քարտ, փոխանցում կամ կանխիկ՝ ձեր ընտրությամբ։',
			'f3.t': 'Երկարակյաց', 'f3.d': 'Յուրաքանչյուր ապրանք փորձարկվում է մեկ տարի։',
			'f4.t': 'Հեշտ վերադարձ', 'f4.d': 'Մտափոխվե՞լ եք։ Վերադարձրեք 30 օրվա ընթացքում։',
			'products.eyebrow': 'Ամենավաճառվող', 'products.title': 'Այս շաբաթվա սիրելիները', 'products.all': 'Բոլոր ապրանքները',
			'quote.text': 'Լամպը հասավ երկու օրում՝ գեղեցիկ փաթեթավորված։ Հյուրերն առաջինը դրա մասին են հարցնում։',
			'band.title': 'Ստացեք 10% զեղչ առաջին պատվերի համար', 'band.text': 'Ամիսը մեկ նամակ։ Առանց սպամի։', 'band.cta': 'Բաժանորդագրվել', 'band.ph': 'Ձեր էլ. հասցեն',
			'footer.about': 'Փոքրիկ խանութ, որը գոյություն ունի միայն html2frame-ը փորձարկելու համար։', 'footer.shop': 'Խանութ', 'footer.help': 'Օգնություն', 'footer.company': 'Ընկերություն',
			'buy': 'Ավելացնել զամբյուղ', 'reviews': 'կարծիք', 'stock': 'Առկա է',
		},
	};
	const t = k => (T[lang] && T[lang][k]) || T.en[k] || k;

	const PRODUCTS = [
		{id: 1, name: 'Aurora Lamp', price: 24500, old: 29900, img: 'img/product-1.png', tag: 'New', rating: 5, reviews: 128},
		{id: 2, name: 'Fern Planter', price: 12500, img: 'img/product-2.jpg', rating: 4, reviews: 64},
		{id: 3, name: 'Violet Throw', price: 18900, old: 22000, img: 'img/product-3.webp', tag: 'Sale', rating: 4, reviews: 39},
		{id: 4, name: 'Ember Mug', price: 6500, img: 'img/product-4.png', rating: 5, reviews: 211},
	];
	// the dram sign has no glyph in Inter: the settings replace it with "AMD" (replaceText)
	const money = n => n.toLocaleString(lang === 'hy' ? 'hy-AM' : 'en-US') + ' ֏';

	const ICON = {
		search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
		bag: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
		moon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
		sun: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
		menu: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="Menu"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
		star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z"/></svg>',
		starOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z"/></svg>',
	};
	const stars = n => '<span class="stars" aria-label="' + n + ' of 5">' + [1, 2, 3, 4, 5].map(i => (i <= n ? ICON.star : ICON.starOff)).join('') + '</span>';

	const session = localStorage.getItem('fixture.session');
	const page = document.body.dataset.page || '';

	// pages that need a login send you to the login page (the capture should warn about this redirect)
	if (document.body.hasAttribute('data-auth') && !session) {
		location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
		return;
	}

	// ---- header and footer -----------------------------------------------------------------------------
	const NAV = [['index.html', 'nav.home', 'home'], ['typography.html', 'nav.type', 'type'], ['boxes.html', 'nav.boxes', 'boxes'], ['images.html', 'nav.images', 'images'], ['forms.html', 'nav.forms', 'forms'], ['edge-cases.html', 'nav.edge', 'edge']];
	const navLinks = NAV.map(([href, key, id]) => '<a href="' + href + '"' + (id === page ? ' class="active"' : '') + '>' + t(key) + '</a>').join('');
	const header = document.createElement('header');
	header.className = 'topbar';
	header.innerHTML = '<div class="wrap topbar-inner">'
		+ '<a class="logo" href="index.html"><img src="img/logo.svg" alt="Fixture logo" width="36" height="36">Fixture</a>'
		+ '<nav class="nav">' + navLinks + '</nav>'
		+ '<div class="nav-actions">'
		+ '<button class="btn btn-ghost btn-sm theme-toggle" type="button"></button>'
		+ '<button class="btn btn-ghost btn-sm hide-phone" type="button" aria-label="Search">' + ICON.search + '</button>'
		+ (session
			? '<a class="btn btn-ghost btn-sm hide-phone" href="account.html">' + t('nav.account') + '</a>'
			: '<a class="btn btn-ghost btn-sm hide-phone" href="login.html">' + t('nav.signin') + '</a>')
		+ '<a class="btn btn-primary btn-sm cart-count" href="#" aria-label="' + t('nav.cart') + '">' + ICON.bag + '<span class="hide-phone">' + t('nav.cart') + '</span></a>'
		+ '<button class="burger" type="button" aria-label="Menu">' + ICON.menu + '</button>'
		+ '</div></div>'
		+ '<div class="mobile-menu">' + NAV.map(([href, key]) => '<a href="' + href + '">' + t(key) + '</a>').join('') + '<a href="' + (session ? 'account.html' : 'login.html') + '">' + t(session ? 'nav.account' : 'nav.signin') + '</a></div>';
	document.body.prepend(header);
	header.querySelector('.burger').addEventListener('click', () => header.querySelector('.mobile-menu').classList.toggle('open'));

	// theme switch: writes the same "theme" cookie the capture's Dark variant sets
	const toggle = header.querySelector('.theme-toggle');
	const showTheme = () => {
		const dark = document.documentElement.dataset.theme === 'dark';
		toggle.innerHTML = dark ? ICON.sun : ICON.moon;
		toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
	};
	toggle.addEventListener('click', () => {
		const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
		document.cookie = 'theme=' + next + '; path=/; max-age=31536000; SameSite=Lax';
		document.documentElement.dataset.theme = next;
		showTheme();
	});
	showTheme();

	const footer = document.createElement('footer');
	footer.className = 'footer';
	footer.innerHTML = '<div class="wrap"><div class="footer-grid">'
		+ '<div><a class="logo" href="index.html" style="color:#fff"><img src="img/logo.svg" alt="" width="32" height="32">Fixture</a><p style="margin-top:12px;max-width:320px">' + t('footer.about') + '</p></div>'
		+ '<div><h4>' + t('footer.shop') + '</h4><a href="product.html?id=1">Lamps</a><a href="product.html?id=2">Planters</a><a href="product.html?id=3">Textiles</a></div>'
		+ '<div><h4>' + t('footer.help') + '</h4><a href="#">Delivery</a><a href="#">Returns</a><a href="#">Contact</a></div>'
		+ '<div><h4>' + t('footer.company') + '</h4><a href="#">About</a><a href="#">Careers</a><a href="#">Press</a></div>'
		+ '</div><div class="footer-bottom"><span>© 2026 Fixture. Test data only.</span><span>Made for html2frame</span></div></div>';
	document.body.appendChild(footer);

	// ---- translations ------------------------------------------------------------------------------------
	document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
	document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });

	// ---- product cards -----------------------------------------------------------------------------------
	document.querySelectorAll('[data-products]').forEach(box => {
		box.innerHTML = PRODUCTS.map(p => '<a class="card" href="product.html?id=' + p.id + '">'
			+ '<div class="card-media"><img src="' + p.img + '" alt="' + p.name + '">' + (p.tag ? '<span class="card-tag">' + p.tag + '</span>' : '') + '</div>'
			+ '<div class="card-body"><span class="card-title">' + p.name + '</span>' + stars(p.rating)
			+ '<span class="price">' + money(p.price) + (p.old ? '<s>' + money(p.old) + '</s>' : '') + '</span></div></a>').join('');
	});

	// ---- product detail (?id=) ---------------------------------------------------------------------------
	const detail = document.querySelector('[data-detail]');
	if (detail) {
		const p = PRODUCTS.find(x => String(x.id) === params.get('id'));
		if (!p) {
			detail.innerHTML = '<h1>Product not found</h1><p class="muted">The address needs ?id=1 … ?id=4. If you see this in a capture, the query string was lost.</p>';
		} else {
			document.title = p.name + ' — Fixture';
			detail.innerHTML = '<div class="crumbs"><a href="index.html">' + t('nav.home') + '</a><span>Shop</span><span>' + p.name + '</span></div>'
				+ '<div class="detail"><div><div class="detail-media"><img src="' + p.img + '" alt="' + p.name + '"></div>'
				+ '<div class="thumbs">' + PRODUCTS.map(x => '<img src="' + x.img + '" alt=""' + (x.id === p.id ? ' class="on"' : '') + '>').join('') + '</div></div>'
				+ '<div>' + (p.tag ? '<span class="badge wait">' + p.tag + '</span>' : '') + '<h1 style="margin-top:12px">' + p.name + '</h1>'
				+ '<div style="display:flex;gap:10px;align-items:center">' + stars(p.rating) + '<span class="muted">' + p.reviews + ' ' + t('reviews') + '</span></div>'
				+ '<p class="price" style="font-size:28px;margin:16px 0">' + money(p.price) + (p.old ? '<s>' + money(p.old) + '</s>' : '') + '</p>'
				+ '<p class="muted">A calm, well-made piece for everyday use. Hand-finished in a small studio and packed without plastic.</p>'
				+ '<div class="field" style="margin-top:16px"><span class="label">Colour</span><div class="colors">'
				+ '<label class="on" style="background:#e64980"><input type="radio" name="c" checked></label><label style="background:#2b8a3e"><input type="radio" name="c"></label><label style="background:#5f3dc4"><input type="radio" name="c"></label><label style="background:#e8590c"><input type="radio" name="c"></label></div></div>'
				+ '<div class="qty"><div class="field"><label for="qty">Quantity</label><input id="qty" type="number" value="1" min="1"></div>'
				+ '<div class="field" style="flex:1"><label for="size">Size</label><select id="size" class="select-custom"><option>Small</option><option selected>Medium</option><option>Large</option></select></div></div>'
				+ '<div style="display:flex;gap:12px"><button class="btn btn-primary" type="button" style="flex:1;justify-content:center">' + ICON.bag + t('buy') + '</button><button class="btn btn-ghost" type="button" aria-label="Save">♡</button></div>'
				+ '<table class="specs"><tr><th>Material</th><td>Ceramic, linen</td></tr><tr><th>Size</th><td>24 × 24 × 36 cm</td></tr><tr><th>Weight</th><td>1.2 kg</td></tr><tr><th>Availability</th><td><span class="badge ok dot">' + t('stock') + '</span></td></tr></table>'
				+ '</div></div>';
		}
	}

	// ---- forms page ----------------------------------------------------------------------------------------
	const form = document.getElementById('demo-form');
	if (form) {
		form.addEventListener('submit', e => {
			e.preventDefault();
			let bad = 0;
			form.querySelectorAll('[required]').forEach(input => {
				const field = input.closest('.field');
				const empty = input.type === 'checkbox' ? !input.checked : !input.value.trim();
				field.classList.toggle('error', empty);
				if (empty) bad++;
			});
			document.getElementById('form-alert').classList.toggle('show', bad > 0);
			document.getElementById('form-alert').textContent = bad + ' field(s) need your attention.';
		});
	}
	const openDialog = document.getElementById('open-dialog');
	if (openDialog) {
		const overlay = document.getElementById('dialog');
		openDialog.addEventListener('click', () => overlay.classList.add('open'));
		overlay.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => overlay.classList.remove('open')));
	}

	// ---- login ---------------------------------------------------------------------------------------------
	const login = document.getElementById('login-form');
	if (login) {
		login.addEventListener('submit', e => {
			e.preventDefault();
			const email = login.querySelector('#email').value.trim();
			const pass = login.querySelector('#password').value;
			const msg = document.getElementById('login-error');
			if (!email || !pass) {
				msg.classList.add('show');
				return;
			}
			localStorage.setItem('fixture.session', email);
			// a short delay, like a real sign-in request
			setTimeout(() => { location.href = params.get('next') || 'account.html'; }, 250);
		});
	}
	const logout = document.getElementById('logout');
	if (logout) logout.addEventListener('click', () => { localStorage.removeItem('fixture.session'); location.href = 'index.html'; });
	const who = document.querySelector('[data-session]');
	if (who) who.textContent = session || '';

	// ---- edge cases: canvas drawn by script --------------------------------------------------------------
	const cv = document.getElementById('canvas');
	if (cv) {
		const g = cv.getContext('2d');
		g.fillStyle = '#3b5bdb';
		g.fillRect(10, 10, 80, 60);
		g.fillStyle = '#f59f00';
		g.beginPath();
		g.arc(130, 40, 30, 0, 7);
		g.fill();
	}

	// ready: a little later, as if translations or data came from the network
	setTimeout(() => {
		document.documentElement.classList.remove('loading');
		document.documentElement.dataset.ready = 'yes';
	}, 400);
})();
