import type { StarstationApi } from '../../shared/types'

declare global {
  interface Window {
    starstation: StarstationApi
  }
}

export const api: StarstationApi = window.starstation
