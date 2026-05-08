"use strict";

function log(scope, message) {
  process.stderr.write(`[smart-price-adjust-v2:${scope}] ${message}\n`);
}

function progress(message) {
  write("进度", message);
}

function success(message) {
  write("完成", message);
}

function fail(message) {
  write("失败", message);
}

function write(label, message) {
  process.stderr.write(`[${label}] ${message}\n`);
}

module.exports = {
  log,
  progress,
  success,
  fail
};
