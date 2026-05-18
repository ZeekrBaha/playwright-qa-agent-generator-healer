import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export function startFixtureServer(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      const dir = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
      const file = path.join(dir, 'login-page.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(file, 'utf8'));
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        url: `http://127.0.0.1:${actualPort}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
