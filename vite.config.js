import { defineConfig } from 'vite';

// Les pages légales sont aussi publiables seules depuis /docs avec GitHub Pages.
export default defineConfig({ publicDir: 'docs' });
