/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** DEV-ONLY flag: activate the backend-free Tauri render mock (`npm run dev:mock`). */
  readonly VITE_DEV_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
