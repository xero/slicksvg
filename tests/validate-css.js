#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import path from 'path';

function checkBin(bin) {
  return new Promise((resolve)=>{
    const p = spawn(bin, ['--version']);
    p.on('close', code=>resolve(code === 0));
    p.on('error', ()=>resolve(false));
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cssPath = path.join(__dirname, '..', 'src', 'theme.css');
const postcssConfigPath = path.join(__dirname, '..', 'postcss.config.js');

async function runPostCSS() {
  const bunxBin = process.platform === 'win32' ? 'bunx.cmd' : 'bunx';
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  let runner = bunxBin;
  if (!(await checkBin(bunxBin))) {
    if (await checkBin(npxBin)) {
      runner = npxBin;
    } else {
      console.error(`✗ bunx / npx was not found in your PATH.
			Please install bun or npm.`);
      process.exit(1);
    }
  }

  return new Promise((resolve, reject)=>{
    const proc = spawn(
      runner, [
        'postcss',
        cssPath,
        '--config',
        postcssConfigPath,
        '--no-map'
      ],{
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data=>{stdout += data.toString()});
    proc.stderr.on('data', data=>{stderr += data.toString()});

    proc.on('close', code=>{
      if (code===0 && !stderr) {
        console.log('✓ CSS validation passed');
        resolve();
      } else {
        console.error('✗ CSS validation failed:');
        if (stderr) console.error(stderr.trim());
        reject(new Error('CSS validation failed'));
      }
    });

    proc.on('error', err=>{
      console.error('✗ Failed to run postcss:', err);
      reject(err);
    });
  });
}

runPostCSS()
  .then(()=>process.exit(0))
  .catch(()=>process.exit(1));
