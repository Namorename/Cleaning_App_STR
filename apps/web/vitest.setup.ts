import '@testing-library/jest-dom/vitest';

import { initI18n } from '@/lib/i18n';

// A fixed language, so assertions can quote what the manager reads.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

initI18n('ru');
