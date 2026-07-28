# VR Viewer

Viewer React + React Three Fiber + WebXR per i letti Nabe.

## Avvio

```bash
npm install
npm run dev
```

## Selezione del letto

Il letto viene scelto una sola volta al caricamento tramite il parametro GET `model`:

```text
/?model=earth
```

Se il parametro manca o ha un formato non valido, il viewer usa `earth`. Se invece il nome è valido ma il relativo catalogo non esiste, il viewer segnala che il letto non è disponibile. Ogni URL carica un solo catalogo letto; il selettore nel viewer mostra esclusivamente le varianti di misura presenti in quel catalogo.

## Struttura dei modelli

Ogni letto ha una cartella dedicata sotto `public/models`:

```text
public/models/
└── earth/
    ├── viewer-models.json
    ├── earth-160x80.glb
    ├── earth-160x80.usdz
    ├── earth-190x80.glb
    ├── earth-190x80.usdz
    ├── earth-190x120.glb
    └── earth-190x120.usdz
```

Per aggiungere Dream, creare `public/models/dream/viewer-models.json` e inserire nella stessa cartella i relativi file GLB e USDZ. Sarà poi disponibile con:

```text
/?model=dream
```

Il catalogo deve contenere un `id`, un `title`, un `defaultModelId` e l'elenco `models` delle varianti di misura.

## Texture ed export USDZ

La texture legno condivisa è `public/textures/abete.png`. È possibile sostituirne l'URL tramite `VITE_WOOD_TEXTURE_URL`.

Per ottimizzare tutti i GLB di un modello con Draco e WebP:

```bash
pnpm optimize fun
```

I file già ottimizzati vengono saltati. Per rigenerarli comunque:

```bash
pnpm optimize fun --force
```

Per creare o rigenerare tutti gli USDZ di un modello con Blender:

```bash
pnpm usdz fun
```

Il comando usa `public/models/<nome>/viewer-models.json`; se il catalogo non esiste lo crea dai GLB presenti nella cartella con il materiale `sharedWood`. Dopo un export riuscito incrementa automaticamente `quickLookVersion` per invalidare la cache di Apple Quick Look.

Blender viene cercato in `/Applications/Blender.app` su macOS e poi nel `PATH`. È possibile indicare un percorso diverso con `BLENDER_BIN`.

La chiamata Blender equivalente, utile per debugging, è:

```bash
blender --background --python scripts/export_bed_usdz.py -- \
  --catalog public/models/earth/viewer-models.json
```
