// backend/src/types/multer-ambient.d.ts
// Minimal typings for multer so that `npm run build` succeeds without @types/multer.

declare module 'multer' {
  import type { RequestHandler } from 'express';

  interface StorageEngine {}

  interface DiskStorageOptions {
    destination?: any;
    filename?: any;
  }

  interface MulterOptions {
    storage?: StorageEngine;
    limits?: any;
    fileFilter?: any;
  }

  interface MulterInstance {
    single(fieldname: string): RequestHandler;
  }

  function multer(options?: MulterOptions): MulterInstance;

  namespace multer {
    function diskStorage(options: DiskStorageOptions): StorageEngine;
  }

  export = multer;
}
