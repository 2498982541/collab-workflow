export type CollabPart = { text: string; color?: string; bold?: boolean; fill?: boolean }

declare module 'claude-code' {
  interface PluginState {
    collab: { parts: CollabPart[] }
  }
}
