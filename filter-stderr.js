#!/usr/bin/env node
/**
 * stderr过滤器 - 只过滤SSL错误和Chromium冗余日志，保留其他日志
 */

const { spawn } = require('child_process');

// 需要过滤的错误模式
const filterPatterns = [
  'ssl_client_socket_impl.cc',
  'handshake failed',
  'SSL error code',
  'net_error -100',
  'net::ERR_CERT',
  'ERROR:ssl',
  // 过滤Chromium的INFO日志（太冗余）
  'INFO:CONSOLE',
  // 过滤其他Chromium内部日志
  'DevTools listening on',
];

function shouldFilter(line) {
  return filterPatterns.some(pattern => line.includes(pattern));
}

// 启动Electron
const electron = spawn('electron', ['.'], {
  stdio: ['inherit', 'inherit', 'pipe'],
  shell: true,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '0',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  }
});

// 过滤stderr
let stderrBuffer = '';
electron.stderr.on('data', (data) => {
  stderrBuffer += data.toString();
  const lines = stderrBuffer.split('\n');
  stderrBuffer = lines.pop() || '';
  
  for (const line of lines) {
    if (!shouldFilter(line)) {
      process.stderr.write(line + '\n');
    }
  }
});

// 输出剩余的buffer
electron.stderr.on('end', () => {
  if (stderrBuffer && !shouldFilter(stderrBuffer)) {
    process.stderr.write(stderrBuffer);
  }
});

electron.on('close', (code) => {
  process.exit(code);
});

electron.on('error', (err) => {
  console.error('Failed to start Electron:', err);
  process.exit(1);
});
