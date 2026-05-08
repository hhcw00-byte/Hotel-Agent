const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (_env, argv = {}) => {
  const isProduction = argv.mode === 'production';
  const devtool = isProduction ? false : 'source-map';
  const devtoolModuleFilenameTemplate = (info) => {
    const resourcePath = info.absoluteResourcePath || info.resourcePath;
    if (!resourcePath) {
      return info.identifier;
    }

    return `file://${resourcePath.replace(/\\/g, '/')}`;
  };

  const mainConfig = {
    mode: isProduction ? 'production' : 'development',
    target: 'electron-main',
    devtool,
    entry: './src/main/index.ts',
    output: {
      path: path.resolve(__dirname, 'dist/main'),
      filename: 'index.js',
      devtoolModuleFilenameTemplate
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js'],
      fallback: {
        "fs": false,
        "path": false,
        "crypto": false
      }
    },
    externals: {
      'mysql2': 'commonjs mysql2',
      'mysql2/promise': 'commonjs mysql2/promise',
      'sql.js': 'commonjs sql.js',
      'ws': 'commonjs ws'
    },
    node: {
      __dirname: false,
      __filename: false
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: false,
              drop_debugger: true,
              dead_code: true,
              passes: 2
            },
            mangle: {
              toplevel: false,
              properties: false
            },
            output: {
              comments: false,
              ascii_only: true
            }
          },
        })
      ]
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          { from: 'skills', to: '../skills' },
          { from: 'agent', to: '../agent' }
        ]
      })
    ]
  };

  const preloadConfig = {
    mode: isProduction ? 'production' : 'development',
    target: 'electron-preload',
    devtool,
    entry: './src/preload/index.ts',
    output: {
      path: path.resolve(__dirname, 'dist/preload'),
      filename: 'index.js',
      devtoolModuleFilenameTemplate
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js']
    }
  };

  const rendererConfig = {
    mode: isProduction ? 'production' : 'development',
    target: 'electron-renderer',
    devtool,
    entry: './src/renderer/app.ts',
    output: {
      path: path.resolve(__dirname, 'dist/renderer'),
      filename: 'app.js',
      devtoolModuleFilenameTemplate
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/renderer/index.html',
        filename: 'index.html'
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'src/renderer/styles', to: 'styles' },
          { from: 'src/renderer/pages', to: 'pages' },
          { from: 'quality/quality-submit.js', to: 'pages/quality/quality-submit.js' }
        ]
      })
    ]
  };

  // 独立的 Google Auth 子进程（不能打包进 mainConfig，需要作为独立 Electron 进程运行）
  const googleAuthSubprocessConfig = {
    mode: isProduction ? 'production' : 'development',
    target: 'electron-main',
    devtool,
    entry: './src/main/google-auth-subprocess.ts',
    output: {
      path: path.resolve(__dirname, 'dist/main'),
      filename: 'google-auth-subprocess.js',
      devtoolModuleFilenameTemplate
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    externals: {
      'electron': 'commonjs electron'
    },
    node: {
      __dirname: false,
      __filename: false
    },
    optimization: {
      minimize: false // 不压缩，方便调试
    }
  };

  return [mainConfig, preloadConfig, rendererConfig, googleAuthSubprocessConfig];
};
