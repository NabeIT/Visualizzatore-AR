# VR Viewer

React + React Three Fiber + WebXR viewer for one GLTF/GLB model.

## Start

```bash
npm install
npm run dev
```

## Model

Default model path:

```text
public/models/letto-completo.glb
```

You can also set a custom path in `.env.local`:

```bash
VITE_MODEL_URL=/models/my-model.gltf
```

For `.gltf` files with external textures or `.bin` files, keep the referenced files in the same public folder structure.

The viewer also loads the wood texture from:

```text
public/textures/wood.jpg
```

iPhone/iPad AR uses Apple Quick Look:

```text
public/models/letto-completo.usdz
```
