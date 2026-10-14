import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/Exam_organizer/',
  build: { outDir: 'dist', sourcemap: false },
})
