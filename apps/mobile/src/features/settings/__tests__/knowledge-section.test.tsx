import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { KnowledgeSection } from '../knowledge-section';

/**
 * The knowledge base as a whole — every article she may read, the company's
 * included — opens from the settings: the bar keeps its tabs (the owner's
 * decision of 2026-10-17, no new tab without need).
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

test('«База знаний» in the settings opens every article she may read', async () => {
  await render(<KnowledgeSection />);

  expect(screen.getByRole('header', { name: 'База знаний' })).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', {
      name: 'Все статьи базы знаний, Инструкции по объектам и общие правила компании',
    }),
  );

  expect(router.push).toHaveBeenCalledWith('/knowledge');
});
