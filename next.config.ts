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
  // PIN to the specific v4 version dirs — do NOT glob the whole model-type
  // folder. Both v2 and v4 ONNX stay committed in git for rollback (via
  // re-export), but the live functions only load the v4 pair. A recursive
  // glob would sweep the v2 files into the bundle too (+86 MB) and blow the
  // 250 MB Vercel function limit once the binary head is enabled. See
  // docs/ml-deploy-runbook.md "Trap 4" and next.config.test.ts (the guard).
  // When you deploy a new model version, bump these paths AND the matching
  // AI_ONNX_*_MODEL_PATH env vars in Vercel together.
  outputFileTracingIncludes: {
    '/api/cron/update-cameras': [
      './ml/artifacts/models/regression_resnet18/20260513_113243_v4_regression_llm_with_flickr/**/*',
      './ml/artifacts/models/binary_resnet18/20260601_063518_v4_binary_llm_with_flickr/**/*',
    ],
    '/api/debug/scoring-smoke': [
      './ml/artifacts/models/regression_resnet18/20260513_113243_v4_regression_llm_with_flickr/**/*',
      './ml/artifacts/models/binary_resnet18/20260601_063518_v4_binary_llm_with_flickr/**/*',
    ],
  },
};

export default nextConfig;
