/// <reference types="svelte" />
/// <reference types="vite/client" />
declare const __APP_VERSION__: { version: string; stable: boolean; commit: string; display: string };
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
