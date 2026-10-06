import { defineConfig } from 'vite';

// GitHub Pages hosts this repository below its repository name.
export default defineConfig({
  base: '/metro-station-game/',
  build: { rolldownOptions: { input: 'app.html' } },
});
