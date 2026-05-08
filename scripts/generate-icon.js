/**
 * 生成一个合规的 256x256 ICO 文件（含多尺寸）
 * 使用 BMP 格式嵌入，不依赖任何第三方库
 */
const fs = require('fs');
const path = require('path');

function createBMPData(size) {
  // 创建 32bpp BGRA 位图数据（带 alpha 通道）
  const rowSize = size * 4;
  const pixelDataSize = rowSize * size;
  // AND mask: 每行 bit 对齐到 32 位
  const andMaskRowSize = Math.ceil(size / 32) * 4;
  const andMaskSize = andMaskRowSize * size;
  
  const bmpInfoHeaderSize = 40;
  const totalSize = bmpInfoHeaderSize + pixelDataSize + andMaskSize;
  
  const buf = Buffer.alloc(totalSize);
  
  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, 0);           // biSize
  buf.writeInt32LE(size, 4);          // biWidth
  buf.writeInt32LE(size * 2, 8);      // biHeight (doubled for ICO)
  buf.writeUInt16LE(1, 12);           // biPlanes
  buf.writeUInt16LE(32, 14);          // biBitCount
  buf.writeUInt32LE(0, 16);           // biCompression (BI_RGB)
  buf.writeUInt32LE(pixelDataSize + andMaskSize, 20); // biSizeImage
  buf.writeInt32LE(0, 24);            // biXPelsPerMeter
  buf.writeInt32LE(0, 28);            // biYPelsPerMeter
  buf.writeUInt32LE(0, 32);           // biClrUsed
  buf.writeUInt32LE(0, 36);           // biClrImportant
  
  // 像素数据 (BGRA, bottom-up)
  // 画一个简单的蓝色圆角矩形 + 白色 "H" 字母
  const cx = size / 2;
  const cy = size / 2;
  const offset = bmpInfoHeaderSize;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = offset + (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = size * 0.45;
      
      if (dist <= radius) {
        // 圆形背景: 深蓝色 #1a73e8
        const edgeDist = radius - dist;
        const alpha = Math.min(255, edgeDist * (255 / 2));
        
        // 检查是否在 "H" 字母区域
        const nx = x / size;
        const ny = y / size;
        const isH = (
          // 左竖线
          (nx >= 0.30 && nx <= 0.38 && ny >= 0.28 && ny <= 0.72) ||
          // 右竖线
          (nx >= 0.62 && nx <= 0.70 && ny >= 0.28 && ny <= 0.72) ||
          // 横线
          (nx >= 0.38 && nx <= 0.62 && ny >= 0.46 && ny <= 0.54)
        );
        
        if (isH) {
          // 白色字母
          buf[idx + 0] = 255; // B
          buf[idx + 1] = 255; // G
          buf[idx + 2] = 255; // R
          buf[idx + 3] = Math.round(alpha); // A
        } else {
          // 蓝色背景 #1a73e8 -> BGR
          buf[idx + 0] = 0xe8; // B
          buf[idx + 1] = 0x73; // G
          buf[idx + 2] = 0x1a; // R
          buf[idx + 3] = Math.round(alpha); // A
        }
      } else {
        // 透明
        buf[idx + 0] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
      }
    }
  }
  
  // AND mask (全 0 = 全不透明，alpha 通道已处理透明度)
  const andOffset = offset + pixelDataSize;
  buf.fill(0, andOffset, andOffset + andMaskSize);
  
  return { buf, totalSize };
}

function createICO(sizes) {
  const entries = sizes.map(size => createBMPData(size));
  
  // ICO header: 6 bytes
  // ICO directory entries: 16 bytes each
  const headerSize = 6 + sizes.length * 16;
  let dataOffset = headerSize;
  
  // 计算总大小
  let totalSize = headerSize;
  for (const entry of entries) {
    totalSize += entry.totalSize;
  }
  
  const ico = Buffer.alloc(totalSize);
  
  // ICO header
  ico.writeUInt16LE(0, 0);      // reserved
  ico.writeUInt16LE(1, 2);      // type (1 = ICO)
  ico.writeUInt16LE(sizes.length, 4); // count
  
  // Directory entries
  let currentOffset = headerSize;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const entry = entries[i];
    const dirOffset = 6 + i * 16;
    
    ico[dirOffset + 0] = size >= 256 ? 0 : size;  // width (0 = 256)
    ico[dirOffset + 1] = size >= 256 ? 0 : size;  // height (0 = 256)
    ico[dirOffset + 2] = 0;                         // color palette
    ico[dirOffset + 3] = 0;                         // reserved
    ico.writeUInt16LE(1, dirOffset + 4);            // color planes
    ico.writeUInt16LE(32, dirOffset + 6);           // bits per pixel
    ico.writeUInt32LE(entry.totalSize, dirOffset + 8);  // data size
    ico.writeUInt32LE(currentOffset, dirOffset + 12);   // data offset
    
    // Copy BMP data
    entry.buf.copy(ico, currentOffset);
    currentOffset += entry.totalSize;
  }
  
  return ico;
}

// 生成包含多尺寸的 ICO: 16, 32, 48, 256
const ico = createICO([16, 32, 48, 256]);
const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
fs.mkdirSync(path.dirname(iconPath), { recursive: true });
fs.writeFileSync(iconPath, ico);
console.log(`Generated icon.ico (${ico.length} bytes) with sizes: 16, 32, 48, 256`);
