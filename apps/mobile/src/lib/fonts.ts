// Each weight from its own entry: the package's index requires all sixteen
// files, and every file it requires would ship in the update (four are ~0.53 MB).
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';

import { NUNITO_FAMILY } from '@/components/text';

/**
 * Nunito, the direction's font, in the four weights it uses (decisions §1),
 * keyed by the family the text component draws each weight with. They are
 * JavaScript assets of the update — no native part (docs/redesign-plan.md §5:
 * an update's files are downloaded before it is launched).
 */
export const NUNITO_FONTS: Readonly<Record<string, number>> = {
  [NUNITO_FAMILY[400]]: Nunito_400Regular,
  [NUNITO_FAMILY[600]]: Nunito_600SemiBold,
  [NUNITO_FAMILY[700]]: Nunito_700Bold,
  [NUNITO_FAMILY[800]]: Nunito_800ExtraBold,
};
