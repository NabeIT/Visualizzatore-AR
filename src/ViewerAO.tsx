import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';

import { ToneMappingMode } from 'postprocessing';
import { useXR } from '@react-three/xr';

export default function ViewerAO() {
  const isInXR = useXR((state) => Boolean(state.session));

  if (isInXR) {
    return null;
  }

  return (
    <EffectComposer multisampling={0} resolutionScale={0.8}>
      <N8AO
        halfRes

        aoSamples={16}
        denoiseSamples={8}
        denoiseRadius={16}
        aoRadius={0.3}
        distanceFalloff={0.6}

        intensity={6}
        color="#0d0d0d"
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
