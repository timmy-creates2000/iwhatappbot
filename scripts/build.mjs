#!/usr/bin/env node

/**
 * Build script for Render deployment
 * Handles building specific workspace packages
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const workspace = args[0] || '@workspace/api-server';

console.log(`🔨 Building ${workspace}...`);

try {
  // For npm workspaces, we need to build from the root
  if (workspace === '@workspace/api-server') {
    console.log('📦 Building API server...');
    execSync('npm run build --workspace=artifacts/api-server', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } else if (workspace === '@workspace/app') {
    console.log('📦 Building frontend app...');
    execSync('npm run build', {
      stdio: 'inherit',
      cwd: join(process.cwd(), 'artifacts/app'),
    });
  } else {
    throw new Error(`Unknown workspace: ${workspace}`);
  }

  console.log('✅ Build completed successfully!');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
