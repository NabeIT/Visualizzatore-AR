#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  bumpQuickLookVersions,
  ensureViewerCatalog,
  findGlbFiles,
  formatBytes,
  getModelDirectory,
  getRequestedModelName,
  projectRoot,
} from './model_pipeline.mjs';

try {
  const modelName = getRequestedModelName();
  const modelDirectory = getModelDirectory(modelName);
  const glbFiles = findGlbFiles(modelDirectory);
  const { catalog, catalogPath } = ensureViewerCatalog(modelName, modelDirectory, glbFiles);
  const blender = findBlender();

  console.log(`Esporto ${catalog.models.length} varianti USDZ per ${modelName}...\n`);
  const result = spawnSync(
    blender,
    [
      '--background',
      '--python',
      resolve(projectRoot, 'scripts', 'export_bed_usdz.py'),
      '--',
      '--catalog',
      catalogPath,
    ],
    { cwd: projectRoot, encoding: 'utf8', stdio: 'inherit' },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Blender ha terminato con codice ${result.status ?? 'sconosciuto'}`);
  }

  for (const model of catalog.models) {
    const usdzPath = resolve(projectRoot, 'public', model.usdzUrl.replace(/^\//, ''));

    if (!existsSync(usdzPath) || statSync(usdzPath).size === 0) {
      throw new Error(`USDZ non generato: ${model.usdzUrl}`);
    }

    console.log(`${basename(usdzPath)}: ${formatBytes(statSync(usdzPath).size)}`);
  }

  bumpQuickLookVersions(catalogPath, catalog);
  console.log(`\nExport USDZ completato per ${modelName}. Versioni Quick Look aggiornate.`);
} catch (error) {
  console.error(`\nErrore: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

function findBlender() {
  const candidates = [
    process.env.BLENDER_BIN,
    process.platform === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : null,
    'blender',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'blender' || existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Blender non trovato. Installalo oppure imposta BLENDER_BIN con il percorso dell’eseguibile.',
  );
}
