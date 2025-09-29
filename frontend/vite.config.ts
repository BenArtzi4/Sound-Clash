import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Bundle analyzer (only in production)
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true
    })
  ].filter(Boolean),
  
  // Build optimizations
  build: {
    target: 'es2015', // Support older browsers
    minify: 'esbuild', // Fast minification
    sourcemap: false, // Disable sourcemaps in production
    
    // Code splitting optimization
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          'react-vendor': ['react', 'react-dom'],
          'router-vendor': ['react-router-dom'],
          
          // Feature chunks - updated paths
          'pages': [
            './src/pages/LandingPage.tsx',
            './src/pages/game/JoinGamePage.tsx', 
            './src/pages/game/CreateGamePage.tsx',
            './src/pages/game/WaitingRoomPage.tsx',
            './src/pages/game/WaitingRoom.tsx',
            './src/pages/manager/ManagerConsole.tsx',
            './src/pages/NotFoundPage.tsx'
          ]
        },
        
        // Optimize chunk names
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (!assetInfo.name) {
            return 'assets/[name]-[hash].[ext]';
          }
          
          if (/\.css$/.test(assetInfo.name)) {
            return 'assets/css/[name]-[hash].[ext]';
          }
          if (/\.(png|jpe?g|svg|gif|tiff|bmp|ico)$/i.test(assetInfo.name)) {
            return 'assets/images/[name]-[hash].[ext]';
          }
          return 'assets/[name]-[hash].[ext]';
        }
      }
    },
    
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
    
    // Optimize assets
    assetsInlineLimit: 4096, // Inline small assets
  },
  
  // Preview server config
  preview: {
    port: 4173,
    host: true
  },
  
  // Dev server config
  server: {
    port: 3000,
    host: true,
    open: true
  },
  
  // Environment variables
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  }
})
