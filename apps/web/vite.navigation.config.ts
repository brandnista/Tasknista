import { mergeConfig } from 'vite'
import webConfig from './vite.config'

export default mergeConfig(webConfig, {
  cacheDir: '../../.cache/task-detail-navigation',
  optimizeDeps: {
    rolldownOptions: { output: { sourcemap: false } },
  },
})
