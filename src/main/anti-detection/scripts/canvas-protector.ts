// Canvas/WebGL 指纹保护脚本

// 使用 any 类型以兼容 Playwright 和 Electron
type Page = any;

/**
 * 生成 Canvas 保护脚本
 * 核心策略：使用 session seed + 确定性 PRNG 确保同一会话内指纹稳定
 * @param noiseLevel 噪声级别 (0-1)
 * @param platform 运行平台 ('win32' | 'darwin' | 'linux')
 */
export function generateCanvasProtectorScript(noiseLevel: number, platform: string): string {
  // 根据平台选择合适的 WebGL 渲染器信息
  const webglInfo = getWebGLInfoForPlatform(platform);

  return `
  (function() {
    const config = {
      noiseLevel: ${noiseLevel},
      enableWebGL: true
    };

    // === 确定性伪随机数生成器 (Mulberry32) ===
    // 每个会话生成一个固定 seed，确保同一画布内容产生相同指纹
    const SESSION_SEED = ${Math.floor(Math.random() * 2147483647)};

    function mulberry32(seed) {
      return function() {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    // 为每个 canvas 内容生成唯一但确定的 seed
    function getCanvasSeed(canvas) {
      // 用 canvas 尺寸 + session seed 生成确定性哈希
      let hash = SESSION_SEED;
      hash = ((hash << 5) - hash + canvas.width) | 0;
      hash = ((hash << 5) - hash + canvas.height) | 0;
      return hash;
    }

    // === Canvas 2D 指纹保护 ===
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // 对 imageData 注入确定性噪声（不修改原始数据，返回副本）
    function addDeterministicNoise(imageData, rng) {
      const cloned = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      );
      const data = cloned.data;
      for (let i = 0; i < data.length; i += 4) {
        if (rng() < config.noiseLevel) {
          data[i]     = data[i]     ^ (rng() < 0.5 ? 1 : 0);     // R
          data[i + 1] = data[i + 1] ^ (rng() < 0.5 ? 1 : 0);     // G
          data[i + 2] = data[i + 2] ^ (rng() < 0.5 ? 1 : 0);     // B
        }
      }
      return cloned;
    }

    // 覆盖 toDataURL：通过克隆 canvas 注入噪声，不污染原始画布
    HTMLCanvasElement.prototype.toDataURL = function() {
      const context = this.getContext('2d');
      if (context) {
        // 克隆一个临时 canvas，在副本上注入噪声
        const clone = document.createElement('canvas');
        clone.width = this.width;
        clone.height = this.height;
        const cloneCtx = clone.getContext('2d');
        // 直接拷贝原始像素（绕过被覆盖的 getImageData）
        const imageData = originalGetImageData.call(context, 0, 0, this.width, this.height);
        const rng = mulberry32(getCanvasSeed(this));
        const noisyData = addDeterministicNoise(imageData, rng);
        cloneCtx.putImageData(noisyData, 0, 0);
        return originalToDataURL.apply(clone, arguments);
      }
      return originalToDataURL.apply(this, arguments);
    };

    // 覆盖 toBlob：同样使用克隆 canvas
    HTMLCanvasElement.prototype.toBlob = function(callback) {
      const context = this.getContext('2d');
      if (context) {
        const clone = document.createElement('canvas');
        clone.width = this.width;
        clone.height = this.height;
        const cloneCtx = clone.getContext('2d');
        const imageData = originalGetImageData.call(context, 0, 0, this.width, this.height);
        const rng = mulberry32(getCanvasSeed(this));
        const noisyData = addDeterministicNoise(imageData, rng);
        cloneCtx.putImageData(noisyData, 0, 0);
        // 传递剩余参数（mimeType, quality）
        const args = Array.prototype.slice.call(arguments);
        args[0] = callback;
        return originalToBlob.apply(clone, args);
      }
      return originalToBlob.apply(this, arguments);
    };

    // 覆盖 getImageData：返回带噪声的副本，不修改原始画布
    // 将读取区域 (sx, sy) 纳入 seed，确保同一区域返回稳定噪声
    CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
      const imageData = originalGetImageData.apply(this, arguments);
      var seed = getCanvasSeed(this.canvas);
      seed = ((seed << 5) - seed + (sx | 0)) | 0;
      seed = ((seed << 5) - seed + (sy | 0)) | 0;
      const rng = mulberry32(seed);
      return addDeterministicNoise(imageData, rng);
    };

    // === WebGL 指纹保护 ===
    if (config.enableWebGL) {
      const spoofedVendor = '${webglInfo.vendor}';
      const spoofedRenderer = '${webglInfo.renderer}';

      // 覆盖 WebGLRenderingContext
      const getParameterWebGL1 = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return spoofedVendor;   // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return spoofedRenderer;  // UNMASKED_RENDERER_WEBGL
        return getParameterWebGL1.apply(this, arguments);
      };

      // 覆盖 WebGL2RenderingContext（现代浏览器默认使用 WebGL2）
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const getParameterWebGL2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) return spoofedVendor;
          if (parameter === 37446) return spoofedRenderer;
          return getParameterWebGL2.apply(this, arguments);
        };
      }
    }
  })();
  `;
}

/**
 * 根据运行平台返回匹配的 WebGL 渲染器信息
 * 避免跨平台不一致被检测
 */
function getWebGLInfoForPlatform(platform: string): { vendor: string; renderer: string } {
  switch (platform) {
    case 'win32':
      return {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'
      };
    case 'darwin':
      return {
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'
      };
    default: // linux
      return {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)'
      };
  }
}

/**
 * 保护 Canvas 指纹
 * @param page Playwright 页面实例
 * @param noiseLevel 噪声级别 (默认 0.001)
 * @param platform 运行平台 (默认取 process.platform)
 */
export async function protectCanvasFingerprint(
  page: Page,
  noiseLevel: number = 0.001,
  platform: string = process.platform
): Promise<void> {
  try {
    const script = generateCanvasProtectorScript(noiseLevel, platform);
    await page.addInitScript(script);
  } catch (error) {
    console.error('[Canvas Protector] Failed to inject script:', error);
  }
}
