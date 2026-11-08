// Builds the single-file dist/index.html: esbuild IIFE bundle of src/main.js
// + inlined src/styles.css, so the app runs from one HTML file (and in tests).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

const out = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  write: false,
  minify: false,
});

const js = out.outputFiles[0].text;
const css = readFileSync('src/styles.css', 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#e9eafc">
<title>Kira</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${js}</script>
</body>
</html>
`;
writeFileSync('dist/index.html', html);
console.log('dist/index.html written:', html.length, 'bytes');
