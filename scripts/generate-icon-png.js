/**
 * 生成 1024x1024 PNG 图标（用于 macOS 打包）
 * 纯 Node.js 实现，不依赖第三方库
 * 生成一个蓝色圆形背景 + 白色 "H" 字母的图标
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;

function createPNG(size) {
  // 生成 RGBA 像素数据
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = size * 0.45;

      if (dist <= radius) {
        const edgeDist = radius - dist;
        const alpha = Math.min(255, Math.round(edgeDist * (255 / 2)));

        // 检查是否在 "H" 字母区域
        const nx = x / size;
        const ny = y / size;
        const isH = (
          (nx >= 0.30 && nx <= 0.38 && ny >= 0.28 && ny <= 0.72) ||
          (nx >= 0.62 && nx <= 0.70 && ny >= 0.28 && ny <= 0.72) ||
          (nx >= 0.38 && nx <= 0.62 && ny >= 0.46 && ny <= 0.54)
        );

        if (isH) {
          pixels[idx + 0] = 255; // R
          pixels[idx + 1] = 255; // G
          pixels[idx + 2] = 255; // B
          pixels[idx + 3] = alpha;
        } else {
          pixels[idx + 0] = 0x1a; // R
          pixels[idx + 1] = 0x73; // G
          pixels[idx + 2] = 0xe8; // B
          pixels[idx + 3] = alpha;
        }
      } else {
        pixels[idx + 0] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }

  // 构建 PNG 文件
  // PNG 每行需要一个 filter byte（0 = None）
  const rawData = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0; // filter byte: None
    pixels.copy(rawData, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // PNG 签名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);  // width
  ihdr.writeUInt32BE(size, 4);  // height
  ihdr[8] = 8;                   // bit depth
  ihdr[9] = 6;                   // color type (RGBA)
  ihdr[10] = 0;                  // compression
  ihdr[11] = 0;                  // filter
  ihdr[12] = 0;                  // interlace

  const chunks = [
    createChunk('IHDR', ihdr),
    createChunk('IDAT', compressed),
    createChunk('IEND', Buffer.alloc(0)),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData) >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 实现
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return crc ^ 0xFFFFFFFF;
}

const png = createPNG(SIZE);
const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(iconPath), { recursive: true });
fs.writeFileSync(iconPath, png);
console.log(`Generated icon.png (${png.length} bytes, ${SIZE}x${SIZE})`);
