// html2frame — MIT License, © 2026 Ruben Vardanyan (see LICENSE)
// static-server.js — serves a project folder exactly as it is on disk.
// No clean URLs and no redirects: "page.html?slug=x" must keep its query (RESEARCH §4).

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
	'.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
	'.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
	'.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

// folder -> {origin: "http://127.0.0.1:<port>", close()}
function start(folder) {
	const root = path.resolve(folder);
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return Promise.reject(new Error('Folder not found: ' + root));

	const server = http.createServer((req, res) => {
		let rel;
		try {
			rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		} catch (e) {
			res.writeHead(400);
			return res.end('Bad request');
		}
		let file = path.join(root, rel);
		if (file !== root && !file.startsWith(root + path.sep)) {
			res.writeHead(403);
			return res.end('Forbidden');
		}
		fs.stat(file, (err, st) => {
			if (!err && st.isDirectory()) {
				file = path.join(file, 'index.html');
				st = fs.existsSync(file) ? fs.statSync(file) : null;
			}
			if (err || !st || !st.isFile()) {
				res.writeHead(404, {'Content-Type': 'text/plain'});
				return res.end('Not found');
			}
			res.writeHead(200, {
				'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
				'Content-Length': st.size,
				'Cache-Control': 'no-store',
			});
			if (req.method === 'HEAD') return res.end();
			fs.createReadStream(file).pipe(res);
		});
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const origin = 'http://127.0.0.1:' + server.address().port;
			resolve({origin, close: () => new Promise(r => {
				server.close(() => r());
				if (server.closeAllConnections) server.closeAllConnections(); // drop the browser's keep-alive sockets
			})});
		});
	});
}

module.exports = {start};
