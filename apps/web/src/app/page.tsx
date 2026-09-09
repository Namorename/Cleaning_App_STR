import { redirect } from 'next/navigation';

/** The root has nothing to show: the proxy has already decided who may be here. */
export default function RootPage() {
  redirect('/dashboard');
}
