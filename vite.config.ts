import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative addresses, so the built site works under any path, such as
  // https://<user>.github.io/StepInside/ on GitHub Pages.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
