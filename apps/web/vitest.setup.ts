import '@testing-library/jest-dom/vitest';

import { initI18n } from '@/lib/i18n';

// A fixed language, so assertions can quote what the manager reads.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

initI18n('ru');

// jsdom's Blob cannot hand over its bytes; every browser the panel runs in
// can (Blob.arrayBuffer). The chat reads a picked photo this way to strip its
// metadata before the upload.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
