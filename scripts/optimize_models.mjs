#!/usr/bin/env node
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  findGlbFiles,
  formatBytes,
  getModelDirectory,
  getRequestedModelName,
  isOptimizedGlb,
  projectRoot,
} from './model_pipeline.mjs';

const temporaryFiles = [];

try {
  const args = process.argv.slice(2);
  const modelName = getRequestedModelName(args);
  const force = args.includes('--force');
  const modelDirectory = getModelDirectory(modelName);
  const glbFiles = findGlbFiles(modelDirectory);
  const gltfTransform = resolve(
    projectRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform',
  );

  if (!existsSync(gltfTransform)) {
    throw new Error('gltf-transform non installato. Esegui prima pnpm install.');
  }

  const filesToOptimize = glbFiles.filter((glbPath) => {
    if (!force && isOptimizedGlb(glbPath)) {
      console.log(`Già ottimizzato, salto: ${basename(glbPath)}`);
      return false;
    }

    return true;
  });

  if (filesToOptimize.length === 0) {
    console.log(`Tutti i GLB di ${modelName} sono già ottimizzati.`);
    process.exit(0);
  }

  for (const inputPath of filesToOptimize) {
    const outputPath = resolve(
      modelDirectory,
      `.${basename(inputPath, '.glb')}.${process.pid}.optimized.glb`,
    );
    temporaryFiles.push(outputPath);

    console.log(`\nOttimizzo ${basename(inputPath)}...`);
    const result = spawnSync(
      gltfTransform,
      [
        'optimize',
        inputPath,
        outputPath,
        '--compress',
        'draco',
        '--simplify',
        'false',
        '--texture-compress',
        'webp',
        '--texture-size',
        '1024',
      ],
      { cwd: projectRoot, encoding: 'utf8', stdio: 'inherit' },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0 || !existsSync(outputPath) || statSync(outputPath).size === 0) {
      throw new Error(`Ottimizzazione fallita: ${basename(inputPath)}`);
    }
  }

  for (let index = 0; index < filesToOptimize.length; index += 1) {
    const inputPath = filesToOptimize[index];
    const outputPath = temporaryFiles[index];
    const originalSize = statSync(inputPath).size;
    const optimizedSize = statSync(outputPath).size;

    renameSync(outputPath, inputPath);
    console.log(
      `${basename(inputPath)}: ${formatBytes(originalSize)} → ${formatBytes(optimizedSize)}`,
    );
  }

  console.log(`\nOttimizzazione completata per ${modelName}.`);
} catch (error) {
  for (const temporaryFile of temporaryFiles) {
    rmSync(temporaryFile, { force: true });
  }

  console.error(`\nErrore: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
