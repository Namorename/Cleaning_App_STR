import {
  BottomTabBarHeightCallbackContext,
  type BottomTabBarProps,
  type BottomTabNavigationOptions,
} from 'expo-router/tabs';
import { use, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { IconSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Text } from './text';

/** The pill a tab's icon sits in (directions.json, `shape.activeTab`; the page's `.tab .pill`). */
const PILL_WIDTH = 60;
const PILL_HEIGHT = 30;

/**
 * Whether the navigator keeps a screen out of the bar. expo-router turns a
 * screen's `href: null` into exactly this (`build/layouts/TabsClient.js`): the
 * item styled out of the row and a button that draws nothing. The technician's
 * tabs will hide the cleaner's that way.
 */
function isHidden(options: BottomTabNavigationOptions): boolean {
  return StyleSheet.flatten(options.tabBarItemStyle)?.display === 'none';
}

function titleOf(options: BottomTabNavigationOptions, routeName: string): string {
  return typeof options.tabBarLabel === 'string'
    ? options.tabBarLabel
    : (options.title ?? routeName);
}

/**
 * VoiceOver knows no tab: React Native gives the `tab` role no trait on iOS,
 * and a tab there would be read by its title alone. As the navigator's own bar
 * does, a tab on iOS is a button whose name says it is a tab and where it
 * stands — in her language, where the navigator's is English.
 */
type TabRole = 'tab' | 'button';

/**
 * The phone's tab bar (decisions.md §2, «Вход и вкладки», variant 1), given to
 * the navigator in place of its own: every tab a pill holding its icon, the
 * title under it.
 *
 * The honey of the active pill is 1.4–1.6:1 against the bar, so it is never the
 * only sign (plan §3): the active tab's icon is filled and its title is drawn
 * heavier in the text colour; an inactive tab has no pill, an outline icon and
 * a muted title. A press does what the navigator's own bar did, so whatever
 * listens to `tabPress` — a list scrolling back to its top — keeps working.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const isIos = Platform.OS === 'ios';
  const role: TabRole = isIos ? 'button' : 'tab';
  // The places the reader counts are the tabs she sees, not the hidden ones.
  const shown = state.routes.flatMap((route, index) =>
    isHidden(descriptors[route.key].options) ? [] : [{ route, index }],
  );
  // The navigator's own bar reports its height, which `useBottomTabBarHeight`
  // hands to the screens; this one does too.
  const onHeightChange = use(BottomTabBarHeightCallbackContext);
  const edge = useMemo(() => ({ paddingBottom: Spacing.xs + insets.bottom }), [insets.bottom]);

  const handleLayout = (event: LayoutChangeEvent) => {
    onHeightChange?.(event.nativeEvent.layout.height);
  };

  return (
    <View
      testID="tab-bar"
      accessibilityRole="tablist"
      onLayout={handleLayout}
      style={[styles.bar, edge]}
    >
      {shown.map(({ route, index }, place) => {
        const { options } = descriptors[route.key];
        const isFocused = index === state.index;
        const title = titleOf(options, route.name);
        const name =
          options.tabBarAccessibilityLabel ??
          (isIos ? t('tabs.position', { title, index: place + 1, count: shown.length }) : title);

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };
        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <Tab
            key={route.key}
            title={title}
            role={role}
            accessibilityLabel={name}
            isFocused={isFocused}
            drawIcon={options.tabBarIcon}
            onPress={onPress}
            onLongPress={onLongPress}
            testID={options.tabBarButtonTestID}
          />
        );
      })}
    </View>
  );
}

/** For `<Tabs tabBar={…}>`: one function for the life of the app. */
export function renderTabBar(props: BottomTabBarProps): ReactElement {
  return <TabBar {...props} />;
}

interface TabProps {
  title: string;
  role: TabRole;
  accessibilityLabel: string;
  isFocused: boolean;
  drawIcon: BottomTabNavigationOptions['tabBarIcon'];
  onPress: () => void;
  onLongPress: () => void;
  testID?: string;
}

/** One tab, the whole of it the target: the pill with the icon, the title under it. */
function Tab({
  title,
  role,
  accessibilityLabel,
  isFocused,
  drawIcon,
  onPress,
  onLongPress,
  testID,
}: TabProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: isFocused }}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
    >
      <View testID="tab-pill" style={[styles.pill, isFocused && styles.pillActive]}>
        {drawIcon?.({
          focused: isFocused,
          color: isFocused ? theme.onAccent : theme.textMuted,
          size: IconSize.regular,
        })}
      </View>
      <Text
        variant="caption"
        tone={isFocused ? 'default' : 'muted'}
        weight={isFocused ? 700 : 600}
        align="center"
        numberOfLines={1}
        ellipsizeMode="tail"
        style={styles.title}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      paddingHorizontal: Spacing.xs,
      paddingTop: Spacing.xs,
      backgroundColor: theme.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
    },
    // `flex: 1` sets no basis of its own: the four tabs share the width equally
    // however long their titles are.
    tab: {
      flex: 1,
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.xs,
      borderRadius: Radius.md,
    },
    pressed: { opacity: 0.7 },
    pill: {
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillActive: { backgroundColor: theme.accent },
    // Cut at the tab's edge rather than pushing past it.
    title: { maxWidth: '100%' },
  });
