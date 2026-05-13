import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';

import { ToneMappingMode } from 'postprocessing';
import { useXR } from '@react-three/xr';

type ViewerAOQuality = 'desktop' | 'mobile';

const AO_SETTINGS: Record<
  ViewerAOQuality,
  {
    resolutionScale: number;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
  }
> = {
  desktop: {
    resolutionScale: 1,
    aoSamples: 16,
    denoiseSamples: 8,
    denoiseRadius: 16,
    aoRadius: 0.3,
    distanceFalloff: 0.6,
    intensity: 6,
  },
  mobile: {
    resolutionScale: 1,
    aoSamples: 10,
    denoiseSamples: 6,
    denoiseRadius: 18,
    aoRadius: 0.26,
    distanceFalloff: 0.7,
    intensity: 3.4,
  },
};

export default function ViewerAO({ quality }: { quality: ViewerAOQuality }) {
  const isInXR = useXR((state) => Boolean(state.session));
  const settings = AO_SETTINGS[quality];

  if (isInXR) {
    return null;
  }

  return (
    <EffectComposer multisampling={0} resolutionScale={settings.resolutionScale}>
      <N8AO
        halfRes
        aoSamples={settings.aoSamples}
        denoiseSamples={settings.denoiseSamples}
        denoiseRadius={settings.denoiseRadius}
        aoRadius={settings.aoRadius}
        distanceFalloff={settings.distanceFalloff}
        intensity={settings.intensity}
        color="#0d0d0d"
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
