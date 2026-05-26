import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || 'build/web');
const port = Number(process.env.PORT || process.argv[3] || 8787);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
};

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const requested = normalize(join(root, decoded));
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
    return null;
  }
  if (existsSync(requested) && statSync(requested).isFile()) {
    return requested;
  }
  return join(root, 'index.html');
}

const server = createServer((req, res) => {
  const filePath = resolvePath(req.url || '/');
  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': contentTypes[extname(filePath)] || 'application/octet-stream'
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Boxmatch e2e server listening on http://127.0.0.1:${port}`);
});
