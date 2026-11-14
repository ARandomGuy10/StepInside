import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative addresses, so the built site works under any path, such as
  // https://<user>.github.io/StepInside/ on GitHub Pages.
  base: './',
  build: {
    // The site is several pages: the landing page, the account pages, and
    // the 3D viewer (studio.html). Each is an entry of its own.
    rollupOptions: {
      input: ['index.html', 'studio.html', 'signup.html', 'login.html', 'account.html', 'request.html'],
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
