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
};

export default nextConfig;
