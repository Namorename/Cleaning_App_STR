import { ReviewsView } from '@/features/reviews/reviews-view';
import { roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

/**
 * «Отзывы» (docs/reviews-to-tasks.md §4.4). The data is the client's to fetch;
 * the role is read here, from app_metadata, because the switches are the
 * admin's — the database refuses a manager either way.
 */
export default async function ReviewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <ReviewsView isAdmin={roleOf(user) === 'admin'} />;
}
