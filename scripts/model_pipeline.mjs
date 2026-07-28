import { basename, dirname, resolve } from "node:path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(scriptsDirectory, "..");

export function getRequestedModelName(argv = process.argv.slice(2)) {
  const modelName = argv
    .find((argument) => !argument.startsWith("-"))
    ?.trim()
    .toLowerCase();

  if (!modelName) {
    throw new Error("Manca il nome del modello. Esempio: pnpm optimize fun");
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(modelName)) {
    throw new Error(`Nome modello non valido: ${modelName}`);
  }

  return modelName;
}

export function getModelDirectory(modelName) {
  const modelDirectory = resolve(projectRoot, "public", "models", modelName);

  if (!existsSync(modelDirectory) || !statSync(modelDirectory).isDirectory()) {
    throw new Error(`Cartella modello non trovata: public/models/${modelName}`);
  }

  return modelDirectory;
}

export function findGlbFiles(modelDirectory) {
  const glbFiles = readdirSync(modelDirectory, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".glb"),
    )
    .map((entry) => resolve(modelDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

  if (glbFiles.length === 0) {
    throw new Error(`Nessun GLB trovato in ${modelDirectory}`);
  }

  return glbFiles;
}

export function readGlbJson(glbPath) {
  const data = readFileSync(glbPath);

  if (data.length < 20 || data.toString("ascii", 0, 4) !== "glTF") {
    throw new Error(`File GLB non valido: ${glbPath}`);
  }

  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkType === 0x4e4f534a) {
      return JSON.parse(
        data
          .toString("utf8", chunkStart, chunkStart + chunkLength)
          .replace(/[\0 ]+$/, ""),
      );
    }

    offset = chunkStart + chunkLength;
  }

  throw new Error(`Chunk JSON non trovato nel GLB: ${glbPath}`);
}

export function isOptimizedGlb(glbPath) {
  const glb = readGlbJson(glbPath);
  const extensions = new Set(glb.extensionsUsed ?? []);

  return (
    extensions.has("KHR_draco_mesh_compression") &&
    extensions.has("EXT_texture_webp")
  );
}

export function ensureViewerCatalog(modelName, modelDirectory, glbFiles) {
  const catalogPath = resolve(modelDirectory, "viewer-models.json");
  const catalogExists = existsSync(catalogPath);
  const catalog = catalogExists
    ? JSON.parse(readFileSync(catalogPath, "utf8"))
    : {
        id: modelName,
        title: `Letto evolutivo zero+ ${formatModelName(modelName)}`,
        models: [],
      };

  if (!Array.isArray(catalog.models)) {
    throw new Error(`Catalogo non valido: ${catalogPath}`);
  }

  if (catalog.id && catalog.id !== modelName) {
    throw new Error(
      `Il catalogo dichiara id "${catalog.id}" invece di "${modelName}"`,
    );
  }

  catalog.id = modelName;
  const knownUrls = new Set(
    catalog.models.map((model) => model?.modelUrl).filter(Boolean),
  );
  let changed = !catalogExists;

  for (const glbPath of glbFiles) {
    const fileName = basename(glbPath);
    const modelUrl = `/models/${modelName}/${fileName}`;

    if (knownUrls.has(modelUrl)) {
      continue;
    }

    const baseName = fileName.slice(0, -4);
    const id = baseName.startsWith(`${modelName}-`)
      ? baseName
      : `${modelName}-${baseName}`;

    catalog.models.push({
      id,
      label: formatVariantLabel(baseName),
      modelUrl,
      usdzUrl: `/models/${modelName}/${baseName}.usdz`,
      textureUrl: "/textures/abete.png",
      quickLookVersion: "1",
      materialMode: "sharedWood",
      arTextureBrightness: 1.18,
      arTextureLift: 0.035,
    });
    knownUrls.add(modelUrl);
    changed = true;
  }

  if (!catalog.defaultModelId && catalog.models.length > 0) {
    catalog.defaultModelId = catalog.models[0].id;
    changed = true;
  }

  const expectedGlbs = new Set(
    glbFiles.map((glbPath) => `/models/${modelName}/${basename(glbPath)}`),
  );
  const missingModels = catalog.models.filter(
    (model) => !model?.modelUrl || !expectedGlbs.has(model.modelUrl),
  );

  if (missingModels.length > 0) {
    const missingIds = missingModels
      .map((model) => model?.id || "voce senza id")
      .join(", ");
    throw new Error(
      `Il catalogo contiene GLB mancanti o non validi: ${missingIds}`,
    );
  }

  if (changed) {
    writeCatalog(catalogPath, catalog);
    console.log(
      `${catalogExists ? "Catalogo aggiornato" : "Catalogo creato"}: ${catalogPath}`,
    );
  }

  return { catalog, catalogPath };
}

export function bumpQuickLookVersions(catalogPath, catalog) {
  for (const model of catalog.models) {
    const currentVersion = Number.parseInt(
      String(model.quickLookVersion ?? "0"),
      10,
    );
    model.quickLookVersion = String(
      Number.isFinite(currentVersion) ? currentVersion + 1 : 1,
    );
  }

  writeCatalog(catalogPath, catalog);
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function writeCatalog(catalogPath, catalog) {
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
}

function formatModelName(modelName) {
  return modelName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatVariantLabel(baseName) {
  const dimensions = baseName.match(/(\d+)\s*x\s*(\d+)/i);

  return dimensions ? `${dimensions[1]} x ${dimensions[2]}cm` : baseName;
}
