/**
 * Boot diagnostics — must be imported FIRST in index.ts
 * Outputs to stderr before any other module loads
 */
process.stderr.write(`[CRAWLER-BOOT] pid=${process.pid} node=${process.version} platform=${process.platform}-${process.arch}\n`);
process.stderr.write(`[CRAWLER-BOOT] execPath=${process.execPath}\n`);
process.stderr.write(`[CRAWLER-BOOT] cwd=${process.cwd()} __dirname=${__dirname}\n`);
process.stderr.write(`[CRAWLER-BOOT] ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE}\n`);
export {};
