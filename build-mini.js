#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build script for creating a single minified HTML file
 * Combines CSS and JS into the HTML file and removes standalone files
 */

console.log('🏗️  Starting mini build process...');

// Define file paths
const distDir = path.join(__dirname, 'dist');
const indexPath = path.join(distDir, 'index.html');
const cssPath = path.join(distDir, 'theme.css');
const jsPath = path.join(distDir, 'app.js');

try {
  // Check if all required files exist
  if (!fs.existsSync(indexPath)) {
    throw new Error('index.html not found in dist folder. Run "npm run make" first.');
  }
  if (!fs.existsSync(cssPath)) {
    throw new Error('theme.css not found in dist folder. Run "npm run make" first.');
  }
  if (!fs.existsSync(jsPath)) {
    throw new Error('app.js not found in dist folder. Run "npm run make" first.');
  }

  console.log('📖 Reading built files...');

  // Read the files
  let htmlContent = fs.readFileSync(indexPath, 'utf8');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  console.log('🔄 Combining CSS into HTML...');

  // Replace the CSS link with inline styles
  const cssLinkRegex = /<link rel="stylesheet" href="theme\.css" \/>/;
  if (!cssLinkRegex.test(htmlContent)) {
    throw new Error('Could not find CSS link tag in HTML file');
  }

  const inlineCSS = `<style>${cssContent}</style>`;
  htmlContent = htmlContent.replace(cssLinkRegex, inlineCSS);

  console.log('🔄 Combining JS into HTML...');

  // Replace the JS script tag with inline script (remove type="module" to avoid issues)
  const jsScriptRegex = /<script type="module" src="app\.js"><\/script>/;
  if (!jsScriptRegex.test(htmlContent)) {
    throw new Error('Could not find JS script tag in HTML file');
  }

  // Encode the JavaScript as base64 to avoid escaping issues
  const jsBase64 = Buffer.from(jsContent).toString('base64');
  const inlineJS = `<script>eval(atob("${jsBase64}"));</script>`;
  htmlContent = htmlContent.replace(jsScriptRegex, inlineJS);

  console.log('💾 Writing combined HTML file...');

  // Write the modified HTML back
  fs.writeFileSync(indexPath, htmlContent, 'utf8');

  console.log('🗑️  Removing standalone CSS and JS files...');

  // Remove the standalone files
  fs.unlinkSync(cssPath);
  fs.unlinkSync(jsPath);

  console.log('✅ Mini build completed successfully!');
  console.log(`📄 Combined file: ${indexPath}`);
  
  // Show file size
  const stats = fs.statSync(indexPath);
  const fileSizeInBytes = stats.size;
  const fileSizeInKB = (fileSizeInBytes / 1024).toFixed(2);
  console.log(`📏 Final file size: ${fileSizeInKB} KB`);

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}