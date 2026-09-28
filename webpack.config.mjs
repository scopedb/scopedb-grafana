import { readFileSync } from 'node:fs';
import path from 'node:path';
import CopyPlugin from 'copy-webpack-plugin';
import { SubresourceIntegrityPlugin } from 'webpack-subresource-integrity';
import VirtualModulesPlugin from 'webpack-virtual-modules';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const { id } = JSON.parse(readFileSync(new URL('./src/plugin.json', import.meta.url)));

export default (_, { mode }) => ({
  entry: ['./.cache/grafana-public-path.js', './src/module.ts'],
  devtool: 'source-map',
  externals: [{ 'amd-module': 'module' }, 'react', 'react-dom', 'rxjs', /^@grafana\//],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'swc-loader',
          options: { jsc: { target: 'es2015', parser: { syntax: 'typescript', tsx: true } } },
        },
      },
    ],
  },
  output: {
    path: path.resolve('dist'),
    filename: 'module.js',
    library: { type: 'amd' },
    uniqueName: id,
    publicPath: `public/plugins/${id}/`,
    crossOriginLoading: 'anonymous',
    clean: { keep: /(?:_(?:amd64|arm64)(?:\.exe)?|go_plugin_build_manifest)$/ },
  },
  plugins: [
    new VirtualModulesPlugin({
      '.cache/grafana-public-path.js': `
        import meta from 'amd-module';
        __webpack_public_path__ = meta?.uri
          ? meta.uri.slice(0, meta.uri.lastIndexOf('/') + 1)
          : 'public/plugins/${id}/';
      `,
    }),
    new CopyPlugin({
      patterns: [
        { from: 'README.md' },
        { from: 'LICENSE' },
        { from: 'src/img/logo.svg', to: 'img/logo.svg' },
        {
          from: 'src/plugin.json',
          to: 'plugin.json',
          transform: (content) => {
            const manifest = JSON.parse(content);
            manifest.buildMode = mode;
            manifest.info.version = version;
            manifest.info.updated = new Date().toISOString().slice(0, 10);
            return JSON.stringify(manifest, null, 2);
          },
        },
      ],
    }),
    new SubresourceIntegrityPlugin({ hashFuncNames: ['sha256'] }),
  ],
});
