#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const port = process.env.PORT || 8080;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  
  // Default to index.html
  if (pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = join(__dirname, 'dist', pathname);
  
  try {
    const stats = await stat(filePath);
    if (stats.isFile()) {
      const ext = extname(filePath);
      const contentType = mimeTypes[ext] || 'text/plain';
      
      res.writeHead(200, { 'Content-Type': contentType });
      const content = await readFile(filePath);
      res.end(content);
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
  } catch (error) {
    res.writeHead(404);
    res.end('File not found');
  }
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});