import {
  ICONS,
  THEME_COLORS,
  TONE_COLORS,
  type IconMeaning,
  type LucideIconName,
} from '@str-ops/shared';
import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import * as lucide from 'lucide-react-native/icons';
import { View } from 'react-native';

import { Icon, LUCIDE_GLYPHS, tabBarIcon } from '../icon';

/**
 * Icons by meaning, drawn from Lucide (owner's decision 7). The map names
 * canonical Lucide icons, as the panel checks against `lucide-react`; here
 * against `lucide-react-native`, whose `icons` lists canonical icons only. An
 * alias renders today and is gone in a later major version — Lucide 1.51
 * already made `building-2` an alias of `building-complex`, which the panel's
 * 1.43 does not have yet. So the phone is pinned to the panel's release
 * (`lucide-react-native` 1.43.0, `lucide-react` 1.43.0): one map, one set of
 * pictures, and both apps move to a newer Lucide together.
 */

const light = THEME_COLORS.light;
const MEANINGS = Object.entries(ICONS) as readonly (readonly [IconMeaning, LucideIconName])[];

/** `user-round-check` → `UserRoundCheck`, the name Lucide exports the component under. */
function componentName(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** What Lucide handed the drawing inside an icon's box: its colour, size, fill, dash and glyph. */
function drawingOf(testID: string): Readonly<Record<string, unknown>> {
  const box = screen.getByTestId(testID, { includeHiddenElements: true });
  const [drawing] = box.children;
  if (drawing === undefined || typeof drawing === 'string') {
    throw new Error(`${testID} holds no drawing`);
  }
  return drawing.props;
}

describe('the icon map, against lucide-react-native', () => {
  const canonical: Readonly<Record<string, unknown>> = lucide;

  test.each(MEANINGS)('%s → %s is a canonical Lucide icon', (_meaning, name) => {
    expect(Object.hasOwn(canonical, componentName(name))).toBe(true);
  });

  test.each(MEANINGS)('%s is drawn with Lucide’s own %s', (_meaning, name) => {
    expect(LUCIDE_GLYPHS[name]).toBe(canonical[componentName(name)]);
  });

  test.each(MEANINGS)('%s renders the glyph %s', async (meaning, name) => {
    await render(<Icon name={meaning} testID="icon" />);

    expect(drawingOf('icon').className).toContain(`lucide-${name}`);
  });
});

describe('Icon', () => {
  test('draws at 24 dp in the main text colour by default', async () => {
    await render(<Icon name="nav.myTasks" testID="icon" />);

    expect(drawingOf('icon')).toMatchObject({ width: 24, height: 24, stroke: light.text });
    expect(screen.getByTestId('icon', { includeHiddenElements: true }).props.style).toMatchObject({
      width: 24,
      height: 24,
    });
  });

  test('beside a chip’s words it is 16 dp', async () => {
    await render(<Icon name="status.done" size="small" testID="icon" />);

    expect(drawingOf('icon')).toMatchObject({ width: 16, height: 16 });
  });

  test('draws in a role of the theme, or in a colour of its own', async () => {
    const late = TONE_COLORS.light.overdue.fg;
    await render(
      <>
        <Icon name="action.next" tone="secondary" testID="chevron" />
        <Icon name="status.overdue" tone="secondary" color={late} testID="late" />
      </>,
    );

    expect(drawingOf('chevron').stroke).toBe(light.textSecondary);
    expect(drawingOf('late').stroke).toBe(late);
  });

  test('is decoration by default, hidden from the screen reader', async () => {
    await render(<Icon name="action.next" testID="icon" />);

    expect(screen.queryByRole('image')).toBeNull();
    expect(
      isHiddenFromAccessibility(screen.getByTestId('icon', { includeHiddenElements: true })),
    ).toBe(true);
  });

  test('with a label it is an image the reader stops on and names', async () => {
    await render(<Icon name="status.overdue" accessibilityLabel="Просрочена" />);

    const image = screen.getByRole('image', { name: 'Просрочена' });
    expect(isHiddenFromAccessibility(image)).toBe(false);
  });

  test('«Назначено» is a filled person, «Без исполнителя» a dashed one, «В работе» a filled ▶', async () => {
    await render(
      <>
        <Icon name="status.assigned" testID="assigned" />
        <Icon name="status.nobody" testID="nobody" />
        <Icon name="status.inProgress" testID="working" />
      </>,
    );

    expect(drawingOf('assigned')).toMatchObject({
      fill: light.text,
      className: expect.stringContaining('lucide-user-round'),
    });
    expect(drawingOf('nobody')).toMatchObject({ fill: 'none', strokeDasharray: [2.4, 2] });
    expect(drawingOf('working')).toMatchObject({
      fill: light.text,
      className: expect.stringContaining('lucide-play'),
    });
  });

  test('every other icon is Lucide’s plain outline', async () => {
    await render(<Icon name="status.accepted" testID="icon" />);

    const drawing = drawingOf('icon');
    expect(drawing.fill).toBe('none');
    expect(drawing.strokeDasharray).toBeUndefined();
  });
});

describe('tabBarIcon', () => {
  test('draws a tab’s icon in the navigator’s tint, left to the tab’s title for the reader', async () => {
    const QueueIcon = tabBarIcon('nav.queue');
    await render(
      <View testID="tab">
        <QueueIcon focused={false} color={light.primary} size={25} />
      </View>,
    );

    const [box] = screen.getByTestId('tab', { includeHiddenElements: true }).children;
    if (box === undefined || typeof box === 'string') {
      throw new Error('the tab holds no icon');
    }
    const [drawing] = box.children;
    if (drawing === undefined || typeof drawing === 'string') {
      throw new Error('the tab icon holds no drawing');
    }
    expect(drawing.props).toMatchObject({
      width: 24,
      stroke: light.primary,
      className: expect.stringContaining('lucide-inbox'),
    });
    expect(isHiddenFromAccessibility(box)).toBe(true);
  });
});
