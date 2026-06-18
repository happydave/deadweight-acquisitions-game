/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: {
    host: '0.0.0.0',
    watch: {
      usePolling: true,
    },
  },
  test: {
    environment: 'node',
  },
})
