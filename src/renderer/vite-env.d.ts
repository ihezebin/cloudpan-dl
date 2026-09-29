/// <reference types="vite/client" />
import type { CloudPanAPI } from '../shared/types'
declare global {
  interface Window {
    cloudPan: CloudPanAPI
  }
}
