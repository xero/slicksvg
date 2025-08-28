#!/usr/bin/env node

import postcss from 'postcss';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function validateCSS() {
  let hasErrors = false;
  
  // Capture console.error calls to detect Tailwind errors
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args.join(' ');
    if (message.includes('Cannot apply unknown utility class') || 
        message.includes('PostCSS plugin error') ||
        message.includes('tailwindcss')) {
      hasErrors = true;
    }
    originalConsoleError.apply(console, args);
  };

  try {
    // Load PostCSS config
    const postcssConfig = await import('./postcss.config.js');
    
    // Read the CSS file
    const cssPath = path.join(__dirname, 'src', 'theme.css');
    const css = await fs.readFile(cssPath, 'utf8');
    
    // Process CSS with PostCSS
    const processor = postcss(postcssConfig.default.plugins);
    const result = await processor.process(css, { from: cssPath, to: undefined });
    
    // Restore original console.error
    console.error = originalConsoleError;
    
    if (hasErrors) {
      console.error('✗ CSS validation failed: Detected CSS errors during processing');
      process.exit(1);
    } else {
      console.log('✓ CSS validation passed');
    }
  } catch (error) {
    // Restore original console.error
    console.error = originalConsoleError;
    console.error('✗ CSS validation failed:');
    console.error(error.message);
    process.exit(1);
  }
}

validateCSS();