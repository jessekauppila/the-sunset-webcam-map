import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/**',
      },
    ],
  },
  serverExternalPackages: ['onnxruntime-node', 'sharp'],
  // onnxruntime-node ships ~385 MB of platform binaries (darwin, win32,
  // linux/{x64,arm64} × CPU/CUDA/TensorRT). Vercel functions run linux/x64
  // CPU only — without these excludes the function bundle blows past the
  // 250 MB hard limit and deploys fail.
  outputFileTracingExcludes: {
    '*': [
      'node_modules/onnxruntime-node/bin/napi-v6/darwin/**',
      'node_modules/onnxruntime-node/bin/napi-v6/win32/**',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda*',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_tensorrt*',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_openvino*',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libcudart*',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libcublas*',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libcudnn*',
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libnvinfer*',
    ],
  },
  // Bundle the ONNX model files into the cron + smoke endpoints. The
  // vercel.json `functions.includeFiles` field appears to silently not
  // match `ml/artifacts/models/**` (logs show File doesn't exist at
  // /var/task/ml/artifacts/models/...). Switch to Next's own tracing
  // includes which DO work consistently. Route keys must NOT have the
  // `.ts` suffix and must include the leading `app/` prefix.
  //
  // PIN to the specific v5 shipping-pair dirs — do NOT glob the whole
  // model-type folder. Retired ONNX (v2, v4, non-shipping v5 variants) stays
  // committed in git for rollback, but the live functions only load this
  // pair. A recursive glob would sweep every other model into the bundle
  // (+300 MB by now) and blow the 250 MB Vercel function limit. See
  // docs/ml-deploy-runbook.md "Trap 4" and next.config.test.ts (the guard).
  // When you deploy a new model version, bump these paths AND the matching
  // AI_ONNX_*_MODEL_PATH env vars in Vercel together.
  outputFileTracingIncludes: {
    '/api/cron/update-cameras': [
      './ml/artifacts/models/regression_resnet18/20260830_190519_v5_quality_llm_backbone_finetune/**/*',
      './ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/**/*',
    ],
    '/api/debug/scoring-smoke': [
      './ml/artifacts/models/regression_resnet18/20260830_190519_v5_quality_llm_backbone_finetune/**/*',
      './ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/**/*',
    ],
    '/api/kiosk/tick': [
      './ml/artifacts/models/regression_resnet18/20260830_190519_v5_quality_llm_backbone_finetune/**/*',
      './ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/**/*',
    ],
  },
};

export default nextConfig;
