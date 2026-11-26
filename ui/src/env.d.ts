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

interface ImportMetaEnv {
  /** 示意模式的預設：'on' 時開新局的示意模式預設開（介面示意版 build:preview）；沒設是關（正式遊戲） */
  readonly VITE_DEMO_DEFAULT?: string
}
