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

// jsdom has no top layer, so nothing in it is `:popover-open` or `:modal`.
// Floating UI asks exactly that of every ancestor when it places a popup (a
// menu, a tooltip), and the selector engine jsdom resolves here (nwsapi
// 2.2.27) answers `:modal` by recursing through `:fullscreen` — about a
// minute for the first Base UI menu of a run. The answer is false either way.
if (typeof Element !== 'undefined') {
  const TOP_LAYER = new Set([':popover-open', ':modal']);
  const nativeMatches = Element.prototype.matches;
  Element.prototype.matches = function matches(this: Element, selector: string): boolean {
    return TOP_LAYER.has(selector) ? false : nativeMatches.call(this, selector);
  };
}
