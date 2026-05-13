import {
  ACESFilmicToneMapping,
  Box3,
  BufferAttribute,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  PCFShadowMap,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { Scan } from 'lucide-react';
import type { BufferGeometry, Mesh, Object3D, Texture } from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { XR, createXRStore, useXR } from '@react-three/xr';

import { Line } from '@react-three/drei/core/Line';
import { OrbitControls } from '@react-three/drei/core/OrbitControls';
import { DRACOLoader, GLTFLoader, type GLTF, type OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Preload } from '@react-three/drei/core/Preload';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Text } from '@react-three/drei/core/Text';

const MODEL_CONFIG_URL = import.meta.env.VITE_MODEL_CONFIG_URL || '/viewer-models.json';
const DEFAULT_MODEL_URL = import.meta.env.VITE_MODEL_URL || '/models/letto-97.glb';
const DEFAULT_USDZ_MODEL_URL = import.meta.env.VITE_USDZ_MODEL_URL || '/models/letto-97.usdz';
const DEFAULT_WOOD_TEXTURE_URL = import.meta.env.VITE_WOOD_TEXTURE_URL || '/textures/wood.jpg';
const QUICK_LOOK_ASSET_VERSION = '9';
const STUDIO_BACKGROUND: [number, number, number] = [1.2, 1.2, 1.2];
const DESKTOP_CAMERA_POSITION: [number, number, number] = [2.55, 1.15, 2.9];
const MOBILE_CAMERA_POSITION: [number, number, number] = [3.55, 1.55, 4.05];
const CAMERA_TARGET: [number, number, number] = [0, 0.26, 0];
const WOOD_BOX_UV_SCALE = 1;
const ENVIRONMENT_INTENSITY = 0.8;
const DIMENSION_LINE_COLOR = '#263238';
const DIMENSION_LABEL_COLOR = '#172327';
const ViewerAO = React.lazy(() => import('./ViewerAO'));

type ViewerModelConfig = {
  id: string;
  label: string;
  modelUrl: string;
  usdzUrl: string;
  textureUrl?: string;
  quickLookVersion?: string;
  materialMode?: 'original' | 'sharedWood';
};

type ViewerMaterialMode = NonNullable<ViewerModelConfig['materialMode']>;

type ViewerModelCatalog = {
  defaultModelId?: string;
  models: ViewerModelConfig[];
};

type PreparedViewerAsset = {
  modelUrl: string;
  materialMode: ViewerMaterialMode;
  gltf: GLTF;
};

const FALLBACK_MODELS: ViewerModelConfig[] = [
  {
    id: 'letto-97',
    label: 'Letto 97',
    modelUrl: DEFAULT_MODEL_URL,
    usdzUrl: DEFAULT_USDZ_MODEL_URL,
    textureUrl: DEFAULT_WOOD_TEXTURE_URL,
    quickLookVersion: QUICK_LOOK_ASSET_VERSION,
    materialMode: 'sharedWood',
  },
];

const preparedAssetCache = new Map<string, Promise<PreparedViewerAsset>>();
const textureCache = new Map<string, Promise<Texture | null>>();

const xrStore = createXRStore({
  emulate: false,
  offerSession: false,
  frameRate: 'high',
  frameBufferScaling: 'high',
});

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export default function App() {
  const [arReady, setArReady] = useState<boolean | null>(null);
  const [quickLookOpening, setQuickLookOpening] = useState(false);
  const [xrError, setXrError] = useState('');
  const mobileSafariCompat = useMobileSafariCompatibility();
  const modelCatalog = useModelCatalog();
  const selectedModel = modelCatalog.selectedModel;
  const selectedMaterialMode = selectedModel.materialMode ?? 'sharedWood';
  const assets = useViewerAssets(
    selectedModel.modelUrl,
    selectedModel.textureUrl ?? DEFAULT_WOOD_TEXTURE_URL,
    selectedMaterialMode,
  );
  const quickLookVersion = selectedModel.quickLookVersion ?? QUICK_LOOK_ASSET_VERSION;
  const quickLookAssetHref = withVersion(selectedModel.usdzUrl, quickLookVersion);
  const quickLookHref = `${quickLookAssetHref}#allowsContentScaling=0`;
  const useQuickLook = mobileSafariCompat;
  const viewerPaused = quickLookOpening && mobileSafariCompat;
  const cameraPosition = mobileSafariCompat ? MOBILE_CAMERA_POSITION : DESKTOP_CAMERA_POSITION;
  const selectedAssetsReady =
    assets.status === 'ready' &&
    assets.modelUrl === selectedModel.modelUrl &&
    assets.materialMode === selectedMaterialMode;

  usePreloadModelAssets(modelCatalog.models);
  useQuickLookWarmup(mobileSafariCompat, quickLookAssetHref);

  useEffect(() => {
    let alive = true;
    const xr = navigator.xr;

    if (!xr) {
      setArReady(false);
      return;
    }

    xr.isSessionSupported('immersive-ar')
      .then((supported) => {
        if (alive) {
          setArReady(supported);
        }
      })
      .catch(() => {
        if (alive) {
          setArReady(false);
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!quickLookOpening) {
      return;
    }

    const closeOpeningState = () => setQuickLookOpening(false);
    const timeout = window.setTimeout(closeOpeningState, 7000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        closeOpeningState();
      }
    };

    window.addEventListener('focus', closeOpeningState);
    window.addEventListener('pageshow', closeOpeningState);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('focus', closeOpeningState);
      window.removeEventListener('pageshow', closeOpeningState);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [quickLookOpening]);

  const enterAr = async () => {
    setXrError('');

    try {
      await xrStore.enterAR();
    } catch (error) {
      setXrError(error instanceof Error ? error.message : 'AR non disponibile');
    }
  };

  return (
    <main className="viewer-shell">
      <div className="viewer-title" aria-label="Letto evolutivo zero+ Earth">
        Letto evolutivo zero+ Earth
      </div>

      <ArButton
        arReady={arReady}
        onQuickLookOpen={() => setQuickLookOpening(true)}
        quickLookHref={quickLookHref}
        onEnterAr={enterAr}
        useQuickLook={useQuickLook}
      />
      <ModelSwitcher
        models={modelCatalog.models}
        selectedModelId={selectedModel.id}
        onSelect={modelCatalog.selectModel}
      />

      {xrError ? <p className="viewer-alert">{xrError}</p> : null}
      {assets.status === 'error' && assets.modelUrl === selectedModel.modelUrl ? (
        <p className="viewer-alert">{assets.message}</p>
      ) : null}
      {quickLookOpening ? <ArOpeningOverlay /> : null}

      <Canvas
        dpr={mobileSafariCompat ? [1, 2] : [1, 2]}
        frameloop={viewerPaused ? 'never' : mobileSafariCompat ? 'always' : 'demand'}
        shadows
        camera={{ position: cameraPosition, fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace;
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.9;
          gl.shadowMap.type = PCFShadowMap;
        }}
      >
        <color attach="background" args={STUDIO_BACKGROUND} />
        <XR store={xrStore}>
          {selectedAssetsReady && !viewerPaused ? (
            <Scene
              assets={assets}
              aoQuality={mobileSafariCompat ? 'mobile' : 'desktop'}
              cameraPosition={cameraPosition}
            />
          ) : null}
        </XR>
      </Canvas>

      {/* <FpsBox active={!viewerPaused} /> */}
    </main>
  );
}

function useModelCatalog() {
  const [catalog, setCatalog] = useState<ViewerModelCatalog>({
    defaultModelId: FALLBACK_MODELS[0].id,
    models: FALLBACK_MODELS,
  });
  const [selectedModelId, setSelectedModelId] = useState(FALLBACK_MODELS[0].id);

  useEffect(() => {
    let active = true;

    fetch(MODEL_CONFIG_URL, { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Model config failed: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        if (!active) {
          return;
        }

        const nextCatalog = normalizeModelCatalog(data);
        setCatalog(nextCatalog);
        setSelectedModelId((currentModelId) => {
          const hasCurrentModel = nextCatalog.models.some((model) => model.id === currentModelId);
          return hasCurrentModel ? currentModelId : nextCatalog.defaultModelId ?? nextCatalog.models[0].id;
        });
      })
      .catch((error) => {
        if (active) {
          console.warn('Model config failed, using fallback model', error);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return useMemo(() => {
    const selectedModel =
      catalog.models.find((model) => model.id === selectedModelId) ?? catalog.models[0];

    return {
      models: catalog.models,
      selectedModel,
      selectModel: setSelectedModelId,
    };
  }, [catalog, selectedModelId]);
}

function normalizeModelCatalog(data: unknown): ViewerModelCatalog {
  if (!data || typeof data !== 'object') {
    return {
      defaultModelId: FALLBACK_MODELS[0].id,
      models: FALLBACK_MODELS,
    };
  }

  const value = data as { defaultModelId?: unknown; models?: unknown };
  const models = Array.isArray(value.models)
    ? value.models.flatMap((model) => {
      const normalizedModel = normalizeModelConfig(model);
      return normalizedModel ? [normalizedModel] : [];
    })
    : [];

  if (models.length === 0) {
    return {
      defaultModelId: FALLBACK_MODELS[0].id,
      models: FALLBACK_MODELS,
    };
  }

  const defaultModelId =
    typeof value.defaultModelId === 'string' && models.some((model) => model.id === value.defaultModelId)
      ? value.defaultModelId
      : models[0].id;

  return {
    defaultModelId,
    models,
  };
}

function normalizeModelConfig(data: unknown): ViewerModelConfig | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const value = data as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : '';
  const label =
    typeof value.label === 'string'
      ? value.label
      : typeof value.name === 'string'
        ? value.name
        : id;
  const modelUrl = typeof value.modelUrl === 'string' ? value.modelUrl : '';
  const usdzUrl = typeof value.usdzUrl === 'string' ? value.usdzUrl : '';

  if (!id || !modelUrl || !usdzUrl) {
    return null;
  }

  return {
    id,
    label,
    modelUrl,
    usdzUrl,
    textureUrl: typeof value.textureUrl === 'string' ? value.textureUrl : DEFAULT_WOOD_TEXTURE_URL,
    quickLookVersion:
      typeof value.quickLookVersion === 'string' || typeof value.quickLookVersion === 'number'
        ? String(value.quickLookVersion)
        : QUICK_LOOK_ASSET_VERSION,
    materialMode: value.materialMode === 'original' ? 'original' : 'sharedWood',
  };
}

function withVersion(url: string, version: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function ArOpeningOverlay() {
  return (
    <div className="ar-opening" role="status" aria-live="polite">
      <div className="ar-opening-spinner" />
      <span>Apro AR...</span>
      <small>Se annulli, torni al viewer.</small>
    </div>
  );
}

function useQuickLookWarmup(enabled: boolean, href: string) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'fetch';
    preload.href = href;
    preload.type = 'model/vnd.usdz+zip';

    const prefetch = document.createElement('link');
    prefetch.rel = 'prefetch';
    prefetch.href = href;
    prefetch.type = 'model/vnd.usdz+zip';

    document.head.append(preload, prefetch);

    const warmupTimer = window.setTimeout(() => {
      fetch(href, {
        cache: 'force-cache',
        credentials: 'same-origin',
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`USDZ warmup failed: ${response.status}`);
          }

          await response.arrayBuffer();
        })
        .catch((error) => {
          if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
            console.warn('USDZ warmup failed', error);
          }
        });
    }, 350);

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(warmupTimer);
      preload.remove();
      prefetch.remove();
    };
  }, [enabled, href]);
}

function useMobileSafariCompatibility() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    const isIOS =
      /iPad|iPhone|iPod/.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isWebKit = /WebKit/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS/i.test(userAgent);
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

    setEnabled(isIOS || (isWebKit && isCoarsePointer));
  }, []);

  return enabled;
}

type ViewerAssets =
  | { status: 'loading' }
  | {
    status: 'ready';
    modelUrl: string;
    materialMode: ViewerMaterialMode;
    gltf: GLTF;
  }
  | { status: 'error'; modelUrl: string; message: string };

function useViewerAssets(
  modelUrl: string,
  woodTextureUrl: string,
  materialMode: ViewerMaterialMode,
): ViewerAssets {
  const [assets, setAssets] = useState<ViewerAssets>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setAssets({ status: 'loading' });

    loadPreparedViewerAsset(modelUrl, woodTextureUrl, materialMode)
      .then((asset) => {
        if (active) {
          setAssets({ status: 'ready', ...asset });
        }
      })
      .catch((error) => {
        console.error('Model load failed', error);

        if (active) {
          setAssets({ status: 'error', modelUrl, message: 'Modello non caricato' });
        }
      });

    return () => {
      active = false;
    };
  }, [materialMode, modelUrl, woodTextureUrl]);

  return assets;
}

function usePreloadModelAssets(models: ViewerModelConfig[]) {
  useEffect(() => {
    let active = true;

    models.forEach((model) => {
      const materialMode = model.materialMode ?? 'sharedWood';
      const textureUrl = model.textureUrl ?? DEFAULT_WOOD_TEXTURE_URL;

      loadPreparedViewerAsset(model.modelUrl, textureUrl, materialMode).catch((error) => {
        if (active) {
          console.warn(`Model preload failed: ${model.modelUrl}`, error);
        }
      });
    });

    return () => {
      active = false;
    };
  }, [models]);
}

function loadPreparedViewerAsset(
  modelUrl: string,
  woodTextureUrl: string,
  materialMode: ViewerMaterialMode,
) {
  const cacheKey = `${modelUrl}|${woodTextureUrl}|${materialMode}`;
  const cachedAsset = preparedAssetCache.get(cacheKey);

  if (cachedAsset) {
    return cachedAsset;
  }

  const assetPromise = Promise.all([
    loadGltf(modelUrl),
    materialMode === 'sharedWood' ? loadWoodTexture(woodTextureUrl) : Promise.resolve(null),
  ]).then(([gltf, woodTexture]) => {
    prepareLoadedModel(gltf, woodTexture, materialMode);

    return {
      modelUrl,
      materialMode,
      gltf,
    };
  });

  assetPromise.catch(() => {
    preparedAssetCache.delete(cacheKey);
  });
  preparedAssetCache.set(cacheKey, assetPromise);
  return assetPromise;
}

function loadGltf(modelUrl: string) {
  const dracoLoader = new DRACOLoader();
  const gltfLoader = new GLTFLoader();

  dracoLoader.setDecoderPath('/draco/');
  gltfLoader.setDRACOLoader(dracoLoader);

  return new Promise<GLTF>((resolve, reject) => {
    gltfLoader.load(
      modelUrl,
      (gltf) => {
        dracoLoader.dispose();
        resolve(gltf);
      },
      undefined,
      (error) => {
        dracoLoader.dispose();
        reject(error);
      },
    );
  });
}

function loadWoodTexture(textureUrl: string) {
  const cachedTexture = textureCache.get(textureUrl);

  if (cachedTexture) {
    return cachedTexture;
  }

  const textureLoader = new TextureLoader();
  const texturePromise = new Promise<Texture | null>((resolve) => {
    textureLoader.load(
      textureUrl,
      (texture) => {
        prepareWoodTexture(texture);
        resolve(texture);
      },
      undefined,
      () => resolve(null),
    );
  });

  textureCache.set(textureUrl, texturePromise);
  return texturePromise;
}

function FpsBox({ active }: { active: boolean }) {
  const [stats, setStats] = useState({ fps: 0, frameMs: 0 });

  useEffect(() => {
    if (!active) {
      return;
    }

    let animationFrame = 0;
    let frameCount = 0;
    let lastSample = performance.now();
    let lastFrame = lastSample;
    let smoothedFrameMs = 0;

    const tick = (now: number) => {
      const frameMs = now - lastFrame;
      lastFrame = now;
      frameCount += 1;
      smoothedFrameMs = smoothedFrameMs === 0 ? frameMs : smoothedFrameMs * 0.9 + frameMs * 0.1;

      const elapsed = now - lastSample;

      if (elapsed >= 250) {
        setStats({
          fps: Math.round((frameCount * 1000) / elapsed),
          frameMs: Math.round(smoothedFrameMs * 10) / 10,
        });
        frameCount = 0;
        lastSample = now;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [active]);

  return (
    <div className="fps-box" aria-label={`FPS ${stats.fps}`}>
      <span>FPS</span>
      <strong>{stats.fps}</strong>
      <small>{stats.frameMs.toFixed(1)} ms</small>
    </div>
  );
}

function ModelSwitcher({
  models,
  selectedModelId,
  onSelect,
}: {
  models: ViewerModelConfig[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
}) {
  if (models.length <= 1) {
    return null;
  }

  return (
    <div className="model-switcher" role="group" aria-label="Selezione modello">
      {models.map((model) => {
        const selected = model.id === selectedModelId;

        return (
          <button
            key={model.id}
            className="model-switcher-button"
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(model.id)}
          >
            {model.label}
          </button>
        );
      })}
    </div>
  );
}

function ArButton({
  arReady,
  onQuickLookOpen,
  quickLookHref,
  onEnterAr,
  useQuickLook,
}: {
  arReady: boolean | null;
  onQuickLookOpen: () => void;
  quickLookHref: string;
  onEnterAr: () => void;
  useQuickLook: boolean;
}) {
  if (!useQuickLook && arReady !== true) {
    return null;
  }

  return (
    <div className="ar-button-wrap">
      {useQuickLook ? (
        <a
          className="ar-button"
          href={quickLookHref}
          onClick={onQuickLookOpen}
          onPointerDown={onQuickLookOpen}
          rel="ar"
          aria-label="Open in AR"
          title="Apri in AR nella stanza"
        >
          <img
            alt=""
            className="ar-quicklook-proxy"
            src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
          />
        </a>
      ) : (
        <button
          className="ar-button"
          type="button"
          onClick={onEnterAr}
          aria-label="Enter AR"
          title="Apri in AR"
        >
          <Scan size={19} aria-hidden="true" />
          <span>Visualizza nella tua stanza</span>
        </button>
      )}
    </div>
  );
}

function Scene({
  assets,
  aoQuality,
  cameraPosition,
}: {
  assets: Extract<ViewerAssets, { status: 'ready' }>;
  aoQuality: 'desktop' | 'mobile';
  cameraPosition: [number, number, number];
}) {
  return (
    <>
      <StudioLighting />
      <GeneratedEnvironment />

      <ModelPresentation gltf={assets.gltf} />

      <InvisibleGround />

      <ViewerCameraControls cameraPosition={cameraPosition} />
      <Suspense fallback={null}>
        <ViewerAO quality={aoQuality} />
      </Suspense>
      <Preload all />
    </>
  );
}

type ModelBounds = {
  box: Box3;
  size: Vector3;
  center: Vector3;
  offset: [number, number, number];
};

type Point3 = [number, number, number];

function ModelPresentation({
  gltf,
}: {
  gltf: GLTF;
}) {
  const bounds = useMemo(() => computeModelBounds(gltf.scene), [gltf.scene]);

  return (
    <group position={bounds?.offset ?? [0, 0, 0]}>
      <SceneErrorBoundary fallback={null}>
        <LoadedModel gltf={gltf} />
      </SceneErrorBoundary>
      {bounds ? <DimensionGuides bounds={bounds} /> : null}
    </group>
  );
}

function DimensionGuides({ bounds }: { bounds: ModelBounds }) {
  const isInXR = useXR((state) => Boolean(state.session));

  if (isInXR) {
    return null;
  }

  const { box, size, center } = bounds;
  const floorY = box.min.y + 0.006;
  const topY = box.max.y;
  const frontZ = box.max.z + 0.18;
  const rightX = box.max.x + 0.18;
  const leftX = box.min.x - 0.18;
  const heightZ = box.max.z;
  const tick = 0.085;
  const floorLabelY = floorY + 0.002;

  return (
    <group renderOrder={8}>
      <DimensionMeasure
        label={`L ${formatCentimeters(size.x)}`}
        labelPosition={[center.x, floorLabelY, frontZ + 0.09]}
        labelRotation={[-Math.PI / 2, 0, 0]}
        line={[
          [box.min.x, floorY, frontZ],
          [box.max.x, floorY, frontZ],
        ]}
        ticks={[
          [
            [box.min.x, floorY, frontZ - tick],
            [box.min.x, floorY, frontZ + tick],
          ],
          [
            [box.max.x, floorY, frontZ - tick],
            [box.max.x, floorY, frontZ + tick],
          ],
        ]}
        extensions={[
          [
            [box.min.x, floorY, box.max.z],
            [box.min.x, floorY, frontZ - tick * 0.65],
          ],
          [
            [box.max.x, floorY, box.max.z],
            [box.max.x, floorY, frontZ - tick * 0.65],
          ],
        ]}
      />

      <DimensionMeasure
        label={`P ${formatCentimeters(size.z)}`}
        labelPosition={[rightX + 0.09, floorLabelY, center.z]}
        labelRotation={[-Math.PI / 2, 0, Math.PI / 2]}
        line={[
          [rightX, floorY, box.min.z],
          [rightX, floorY, box.max.z],
        ]}
        ticks={[
          [
            [rightX - tick, floorY, box.min.z],
            [rightX + tick, floorY, box.min.z],
          ],
          [
            [rightX - tick, floorY, box.max.z],
            [rightX + tick, floorY, box.max.z],
          ],
        ]}
        extensions={[
          [
            [box.max.x, floorY, box.min.z],
            [rightX - tick * 0.65, floorY, box.min.z],
          ],
          [
            [box.max.x, floorY, box.max.z],
            [rightX - tick * 0.65, floorY, box.max.z],
          ],
        ]}
      />

      <DimensionMeasure
        label={`H ${formatCentimeters(size.y)}`}
        labelPosition={[leftX - 0.085, center.y, heightZ]}
        labelRotation={[0, 0, Math.PI / 2]}
        line={[
          [leftX, box.min.y, heightZ],
          [leftX, topY, heightZ],
        ]}
        ticks={[
          [
            [leftX - tick, box.min.y, heightZ],
            [leftX + tick, box.min.y, heightZ],
          ],
          [
            [leftX - tick, topY, heightZ],
            [leftX + tick, topY, heightZ],
          ],
        ]}
        extensions={[
          [
            [box.min.x, box.min.y, heightZ],
            [leftX + tick * 0.65, box.min.y, heightZ],
          ],
          [
            [box.min.x, topY, heightZ],
            [leftX + tick * 0.65, topY, heightZ],
          ],
        ]}
      />
    </group>
  );
}

function DimensionMeasure({
  label,
  labelPosition,
  labelRotation,
  line,
  ticks,
  extensions,
}: {
  label: string;
  labelPosition: Point3;
  labelRotation: Point3;
  line: [Point3, Point3];
  ticks: [Point3, Point3][];
  extensions: [Point3, Point3][];
}) {
  return (
    <group>
      <DimensionLine points={line} opacity={0.92} width={1.45} />
      {ticks.map((points, index) => (
        <DimensionLine key={`tick-${index}`} points={points} opacity={0.92} width={1.45} />
      ))}
      {extensions.map((points, index) => (
        <DimensionLine key={`extension-${index}`} points={points} opacity={0.4} width={0.95} />
      ))}
      <DimensionLabel label={label} position={labelPosition} rotation={labelRotation} />
    </group>
  );
}

function DimensionLine({
  points,
  opacity,
  width,
}: {
  points: [Point3, Point3];
  opacity: number;
  width: number;
}) {
  return (
    <Line
      points={points}
      color={DIMENSION_LINE_COLOR}
      lineWidth={width}
      transparent
      opacity={opacity}
      renderOrder={8}
    />
  );
}

function DimensionLabel({
  label,
  position,
  rotation,
}: {
  label: string;
  position: Point3;
  rotation: Point3;
}) {
  return (
    <Text
      position={position}
      rotation={rotation}
      fontSize={0.065}
      fontWeight={800}
      letterSpacing={0}
      anchorX="center"
      anchorY="middle"
      color={DIMENSION_LABEL_COLOR}
      renderOrder={9}
      material-depthTest
      material-side={DoubleSide}
      material-toneMapped={false}
    >
      {label}
    </Text>
  );
}

function computeModelBounds(object: Object3D): ModelBounds | null {
  const box = new Box3();
  const meshBox = new Box3();
  const size = new Vector3();
  const center = new Vector3();
  const rootInverse = new Matrix4();
  const localMatrix = new Matrix4();
  let hasBounds = false;

  object.updateWorldMatrix(true, true);
  rootInverse.copy(object.matrixWorld).invert();

  object.traverse((child) => {
    const mesh = child as Mesh;

    if (!mesh.isMesh || isHelperBoundsMesh(mesh) || !mesh.geometry.attributes.position) {
      return;
    }

    mesh.geometry.computeBoundingBox();

    if (!mesh.geometry.boundingBox) {
      return;
    }

    localMatrix.copy(rootInverse).multiply(mesh.matrixWorld);
    meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(localMatrix);
    box.union(meshBox);
    hasBounds = true;
  });

  if (!hasBounds) {
    return null;
  }

  box.getSize(size);
  box.getCenter(center);

  return {
    box,
    size,
    center,
    offset: [-center.x, -box.min.y, -center.z],
  };
}

function formatCentimeters(value: number) {
  return `${Math.round(value * 100)} cm`;
}

function InvisibleGround() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.008, 0]}>
        <planeGeometry args={[16, 16]} />
        <meshBasicMaterial colorWrite={false} depthWrite />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]} renderOrder={2}>
        <planeGeometry args={[16, 16]} />
        <shadowMaterial transparent color="#221c17" opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

function StudioLighting() {
  useEffect(() => {
    RectAreaLightUniformsLib.init();
  }, []);

  return (
    <>
      <ambientLight intensity={0.06} />
      <hemisphereLight args={['#ffffff', '#d1c7bb', 0.28]} />
      <rectAreaLight
        color="#fff3df"
        // intensity={5.2}
        intensity={2}
        width={3.8}
        height={2.4}
        position={[-3.4, 3.1, 3.2]}
        rotation={[-0.78, -0.5, -0.18]}
      />
      <directionalLight
        castShadow
        color="#fff4e4"
        position={[3.2, 4.4, 3.2]}
        intensity={2.25}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.6}
        shadow-camera-far={10}
        shadow-camera-left={-3.2}
        shadow-camera-right={3.2}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-bias={-0.00025}
        shadow-normalBias={-0.00000001}
        shadow-radius={2}

      />
      <spotLight
        color="#ffffff"
        position={[-3.6, 2.4, -3.2]}
        intensity={0.45}
        angle={0.68}
        penumbra={1}
        distance={8}
      />
    </>
  );
}

function GeneratedEnvironment() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();

    const environment = pmrem.fromScene(room, 0.04).texture;
    const previousEnvironment = scene.environment;
    const previousEnvironmentIntensity = scene.environmentIntensity;

    scene.environment = environment;
    scene.environmentIntensity = ENVIRONMENT_INTENSITY;

    return () => {
      scene.environment = previousEnvironment;
      scene.environmentIntensity = previousEnvironmentIntensity;
      environment.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  return null;
}

function LoadedModel({ gltf }: { gltf: GLTF }) {
  return (
    <group>
      <primitive object={gltf.scene} />
    </group>
  );
}

function prepareLoadedModel(
  gltf: GLTF,
  woodTexture: Texture | null,
  materialMode: ViewerMaterialMode,
) {
  const woodMaterial = materialMode === 'sharedWood' ? createWoodMaterial(woodTexture) : null;

  gltf.scene.traverse((child) => {
    const mesh = child as Mesh;

    if (!mesh.isMesh) {
      return;
    }

    if (isHelperBoundsMesh(mesh)) {
      mesh.visible = false;
      return;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (woodMaterial) {
      mesh.geometry = ensureBoxUv(mesh.geometry);
      mesh.material = woodMaterial;
    }
  });
}

function isHelperBoundsMesh(mesh: Mesh) {
  const position = mesh.geometry.attributes.position;
  return mesh.name.trim().toLowerCase() === 'cube' && Boolean(position && position.count <= 36);
}

function prepareWoodTexture(texture: Texture) {
  const repeatCount = 2;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatCount, repeatCount * 3);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
}

function createWoodMaterial(woodTexture: Texture | null) {
  return new MeshStandardMaterial({
    name: 'viewer_wood_shared',
    map: woodTexture,
    color: woodTexture ? '#ffffff' : '#d9ad7a',
    roughness: 0.74,
    metalness: 0,
  });
}

function ensureBoxUv(geometry: BufferGeometry) {
  if (geometry.userData.viewerBoxUv || !geometry.attributes.position) {
    return geometry;
  }

  const boxGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = boxGeometry.attributes.position;
  const uv = new Float32Array(position.count * 2);

  const writeUv = (index: number, normalX: number, normalY: number, normalZ: number) => {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const absX = Math.abs(normalX);
    const absY = Math.abs(normalY);
    const absZ = Math.abs(normalZ);

    if (absX >= absY && absX >= absZ) {
      uv[index * 2] = z * WOOD_BOX_UV_SCALE;
      uv[index * 2 + 1] = y * WOOD_BOX_UV_SCALE;
      return;
    }

    if (absY >= absZ) {
      uv[index * 2] = x * WOOD_BOX_UV_SCALE;
      uv[index * 2 + 1] = z * WOOD_BOX_UV_SCALE;
      return;
    }

    uv[index * 2] = x * WOOD_BOX_UV_SCALE;
    uv[index * 2 + 1] = y * WOOD_BOX_UV_SCALE;
  };

  for (let index = 0; index < position.count; index += 3) {
    const ax = position.getX(index);
    const ay = position.getY(index);
    const az = position.getZ(index);
    const bx = position.getX(index + 1);
    const by = position.getY(index + 1);
    const bz = position.getZ(index + 1);
    const cx = position.getX(index + 2);
    const cy = position.getY(index + 2);
    const cz = position.getZ(index + 2);
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const normalX = aby * acz - abz * acy;
    const normalY = abz * acx - abx * acz;
    const normalZ = abx * acy - aby * acx;

    writeUv(index, normalX, normalY, normalZ);
    writeUv(index + 1, normalX, normalY, normalZ);
    writeUv(index + 2, normalX, normalY, normalZ);
  }

  boxGeometry.setAttribute('uv', new BufferAttribute(uv, 2));
  boxGeometry.userData.viewerBoxUv = true;

  return boxGeometry;
}

function ViewerCameraControls({ cameraPosition }: { cameraPosition: [number, number, number] }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const camera = useThree((state) => state.camera);
  const isInXR = useXR((state) => Boolean(state.session));

  useEffect(() => {
    camera.position.set(...cameraPosition);
    controls.current?.target.set(...CAMERA_TARGET);
    controls.current?.update();
  }, [camera, cameraPosition]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!isInXR}
      enableDamping
      dampingFactor={0.08}
      minDistance={2}
      maxDistance={8}
      maxPolarAngle={Math.PI / 2.02}
      target={CAMERA_TARGET}
      enablePan={false}
    />
  );
}
