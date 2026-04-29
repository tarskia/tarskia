/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_FORCE_GUEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'ajv/dist/2020.js' {
  import Ajv from 'ajv';
  export default Ajv;
  export type { ErrorObject, ValidateFunction } from 'ajv';
}
