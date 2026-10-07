// collect.js — tiny local server: serves extract.js and saves each posted page to out/<name>.json
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, {recursive: true});

http.createServer((req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	if (req.method === 'OPTIONS') return res.end();
	const url = new URL(req.url, 'http://localhost');
	if (req.method === 'GET' && url.pathname.endsWith('.js')) {
		res.setHeader('Content-Type', 'text/javascript');
		return fs.createReadStream(path.join(__dirname, path.basename(url.pathname))).pipe(res);
	}
	if (req.method === 'POST' && url.pathname === '/save') {
		const name = (url.searchParams.get('name') || 'page').replace(/[^\w.-]+/g, '_');
		const chunks = [];
		req.on('data', c => chunks.push(c));
		req.on('end', () => {
			fs.writeFileSync(path.join(OUT, name + '.json'), Buffer.concat(chunks));
			res.end('ok');
		});
		return;
	}
	res.statusCode = 404;
	res.end();
}).listen(5502, () => console.log('collector on http://localhost:5502'));
