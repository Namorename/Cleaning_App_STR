import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { Alert, AlertDescription, AlertTitle } from './alert';
import { Checkbox } from './checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Skeleton } from './skeleton';
import { Switch } from './switch';
import { Tabs, TabsList, TabsTrigger } from './tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

/**
 * The shadcn pieces the plan names as missing (2.2): Checkbox, Switch,
 * Skeleton, Tooltip, Alert (Toast is in close-label.test.tsx). Nothing draws
 * them yet; these say they work and wear the theme's names.
 */
describe('the new primitives', () => {
  beforeAll(() => {
    // jsdom has no PointerEvent; Base UI's checkbox and switch build one on a press.
    if (typeof window.PointerEvent !== 'function') {
      Object.defineProperty(window, 'PointerEvent', {
        configurable: true,
        value: class PointerEvent extends MouseEvent {},
      });
    }
  });

  test('a checkbox is a labelled control that toggles', async () => {
    render(<Checkbox aria-label="Показывать отменённые" />);

    const box = screen.getByRole('checkbox', { name: 'Показывать отменённые' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(box).toHaveClass('border-input', 'data-checked:bg-primary');
  });

  test('a switch is a labelled control that toggles', async () => {
    render(<Switch aria-label="Разрешить загрузку из галереи" />);

    const toggle = screen.getByRole('switch', { name: 'Разрешить загрузку из галереи' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
  });

  test('a skeleton is a quiet block of the muted fill', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);

    expect(container.querySelector('[data-slot="skeleton"]')).toHaveClass('bg-muted');
  });

  test('an alert is announced, with its title and description', () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Не удалось сохранить</AlertTitle>
        <AlertDescription>Попробуйте ещё раз.</AlertDescription>
      </Alert>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сохранить');
    expect(screen.getByRole('alert')).toHaveClass('text-destructive');
  });

  test('a tooltip leaves its trigger in place', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>SDT</TooltipTrigger>
          <TooltipContent>Заезд в тот же день</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(screen.getByRole('button', { name: 'SDT' })).toBeInTheDocument();
  });

  test('a tab list never widens the page: on a narrow screen it scrolls within itself', () => {
    // Decision 14: on a phone the page never scrolls sideways — the five tabs
    // of a listing's card are wider than 390 px.
    render(
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Информация</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(screen.getByRole('tablist')).toHaveClass('max-w-full', 'overflow-x-auto');
  });

  // 5.4: the «⋯» of a row. Its items are the row's actions, each a full target.
  test('a dropdown menu opens on its trigger, runs an item and closes', async () => {
    const onEdit = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Действия">⋯</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onEdit}>Изменить</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Отменить уборку</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Действия' }));
    const item = await screen.findByRole('menuitem', { name: 'Изменить' });
    expect(item).toHaveClass('min-h-11');
    expect(screen.getByRole('menuitem', { name: 'Отменить уборку' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );

    await userEvent.click(item);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
