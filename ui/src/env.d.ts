/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// vite.config.ts 只用到 node:url 的這一個函式（沒有裝 @types/node）。
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}
