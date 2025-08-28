import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

describe('Build Logic Error Fix', () => {
  const cssFilePath = path.join(process.cwd(), 'src', 'theme.css');
  const distPath = path.join(process.cwd(), 'dist');
  let originalCssContent: string;
  
  beforeEach(async () => {
    // Save original CSS content
    originalCssContent = await fs.readFile(cssFilePath, 'utf8');
    
    // Clean up any existing dist artifacts
    try {
      await fs.rm(distPath, { recursive: true });
    } catch (error) {
      // Ignore if dist doesn't exist
    }
  });
  
  afterEach(async () => {
    // Restore original CSS content
    await fs.writeFile(cssFilePath, originalCssContent);
    
    // Clean up any dist artifacts
    try {
      await fs.rm(distPath, { recursive: true });
    } catch (error) {
      // Ignore if dist doesn't exist
    }
  });

  it('should fail build when CSS has invalid Tailwind classes', async () => {
    // Introduce a CSS error by changing a valid class to an invalid one
    const brokenCss = originalCssContent.replace('text-face', 'text-invalid-class');
    await fs.writeFile(cssFilePath, brokenCss);
    
    // Try to build - should fail
    let buildResult;
    try {
      buildResult = await execAsync('npm run build', { cwd: process.cwd() });
    } catch (error: any) {
      buildResult = error;
    }
    
    // Build should fail with non-zero exit code
    expect(buildResult.code).toBe(1);
    expect(buildResult.stderr || buildResult.stdout).toContain('CSS validation failed');
    expect(buildResult.stderr || buildResult.stdout).toContain('Cannot apply unknown utility class');
    
    // No dist folder should be created
    const distExists = await fs.access(distPath).then(() => true).catch(() => false);
    expect(distExists).toBe(false);
  });

  it('should succeed build when CSS is valid', { timeout: 15000 }, async () => {
    // CSS should already be valid from beforeEach
    
    // Build should succeed
    const buildResult = await execAsync('npm run build', { cwd: process.cwd() });
    
    expect(buildResult.stdout).toContain('CSS validation passed');
    expect(buildResult.stdout).toContain('✓ built in');
    
    // Dist folder should be created with index.html
    const distIndexPath = path.join(distPath, 'index.html');
    const distIndexExists = await fs.access(distIndexPath).then(() => true).catch(() => false);
    expect(distIndexExists).toBe(true);
  });

  it('should validate CSS separately before running Vite build', async () => {
    // Introduce a CSS error
    const brokenCss = originalCssContent.replace('text-face', 'text-nonexistent');
    await fs.writeFile(cssFilePath, brokenCss);
    
    // Run just the CSS validation step
    let validationResult;
    try {
      validationResult = await execAsync('node validate-css.js', { cwd: process.cwd() });
    } catch (error: any) {
      validationResult = error;
    }
    
    // CSS validation should fail independently
    expect(validationResult.code).toBe(1);
    expect(validationResult.stderr || validationResult.stdout).toContain('CSS validation failed');
  });
});