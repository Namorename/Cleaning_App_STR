import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProblemForm } from '../problem-form';
import { EMPTY_PROBLEM_DRAFT, type ProblemDraft } from '../schema';

type FormProps = Parameters<typeof ProblemForm>[0];

async function renderForm(draft: ProblemDraft, overrides: Partial<FormProps> = {}) {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  await render(
    <ProblemForm
      draft={draft}
      onChange={onChange}
      place="CZ - Nadrazni Apt 6"
      photos={[]}
      onCapture={jest.fn()}
      isSubmitting={false}
      submitLabel="Отправить"
      onSubmit={onSubmit}
      error={null}
      {...overrides}
    />,
  );
  return { onChange, onSubmit };
}

test('keeps the button grey until there is a title', async () => {
  const { onSubmit } = await renderForm(EMPTY_PROBLEM_DRAFT);

  const button = screen.getByRole('button', { name: 'Отправить' });
  expect(button).toBeDisabled();
  await fireEvent.press(button);

  expect(onSubmit).not.toHaveBeenCalled();
});

test('sends once a title is there', async () => {
  const { onSubmit } = await renderForm({ ...EMPTY_PROBLEM_DRAFT, title: 'Кран течёт' });

  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('hands every keystroke back as a new draft', async () => {
  const { onChange } = await renderForm(EMPTY_PROBLEM_DRAFT);

  await fireEvent.changeText(screen.getByLabelText('Что случилось'), 'Кран');

  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_PROBLEM_DRAFT, title: 'Кран' });
});

test('offers the three priorities as radios and reports the choice', async () => {
  const { onChange } = await renderForm(EMPTY_PROBLEM_DRAFT);

  await fireEvent.press(screen.getByRole('radio', { name: 'Высокая' }));

  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_PROBLEM_DRAFT, priority: 'high' });
  expect(screen.getByRole('radio', { name: 'Обычная' })).toBeSelected();
});

test('shows where the problem is and offers the camera', async () => {
  await renderForm(EMPTY_PROBLEM_DRAFT);

  expect(screen.getByText('CZ - Nadrazni Apt 6')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Снять фото' })).toBeTruthy();
});

test('translates a refusal the server sent a key for', async () => {
  await renderForm(
    { ...EMPTY_PROBLEM_DRAFT, title: 'x' },
    {
      error: Object.assign(new Error('The title is longer than 200 characters'), {
        hint: 'serverErrors.problemTitleTooLong',
        details: '{"limit": 200}',
      }),
    },
  );

  expect(screen.getByText('Заголовок длиннее 200 символов')).toBeTruthy();
});
