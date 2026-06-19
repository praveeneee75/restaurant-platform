const http = require('http');
const fs = require('fs');
const path = require('path');

const portArg = process.argv[2] || process.env.PORT || '4300';
const port = Number(portArg);
const root = path.join(__dirname, '..', 'www');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function safeFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0] || '/');
  const relativePath = cleanPath === '/' ? '/index.html' : cleanPath;
  const filePath = path.normalize(path.join(root, relativePath));
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

const server = http.createServer((req, res) => {
  const filePath = safeFilePath(req.url || '/');
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try: npm.cmd run start:3000 or set PORT=4301`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Restaurant mobile app preview running at http://localhost:${port}`);
  console.log('Use POS URL http://localhost:3000 when testing on the same PC.');
});
