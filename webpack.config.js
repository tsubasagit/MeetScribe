const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: {
    background: './src/background.ts',
    popup: './src/popup.ts',
    offscreen: './src/offscreen.ts',
    results: './src/results.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: '[name].css' }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'popup.html', to: 'popup.html' },
        { from: 'popup.css', to: 'popup.css' },
        { from: 'offscreen.html', to: 'offscreen.html' },
        { from: 'results.html', to: 'results.html' },
        { from: 'results.css', to: 'results.css' },
        { from: 'icons', to: 'icons', noErrorOnMissing: true },
      ],
    }),
  ],
  devtool: 'cheap-module-source-map',
};
