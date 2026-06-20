import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative asset paths so the build loads from file:// inside Electron
  base: './',
  plugins: [react()],
});
