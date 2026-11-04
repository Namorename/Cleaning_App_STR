import type { IconMeaning } from '@str-ops/shared';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { Colors, MIN_TOUCH_TARGET, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import type { ViewerItem } from './viewer-items';
import { ViewerVideo } from './viewer-video';
import { ZoomablePhoto, type PageRow } from './zoomable-photo';

export interface PhotoViewerProps {
  /** The files of one row that have something to show (`viewerItemsOf`). */
  items: readonly ViewerItem[];
  /** The row's tiles, those with nothing to show included: «Фото 2 из 5». */
  total: number;
  /** The file tapped: the viewer opens on it. */
  openId: string;
  onClose: () => void;
}

/** The viewer is dark in either theme: a photo reads best on black. */
const VIEWER = Colors.dark;
const SETTLE_MS = 200;
/** Pages beside the one on screen that are drawn, so a swipe finds the next one ready. */
const DRAWN_NEIGHBOURS = 1;

interface Size {
  width: number;
  height: number;
}

/**
 * A row's photos on the whole screen (2026-11-03: until now the phone showed
 * none bigger than its tile, while the panel opened each one in the browser).
 *
 * Opens on the photo tapped; a finger turns to the next and back, two
 * fingers or a double tap bring it closer (zoomable-photo.tsx). The close
 * button and the system's back close it; the arrows at the bottom turn the
 * page too — the way for a screen reader, which keeps the swipe to itself.
 * A video plays in the phone's own player (viewer-video.tsx).
 *
 * The picture is the tile's own source — the file on the phone or the signed
 * link it was drawn from — so a photo taken without signal opens, and one
 * already drawn is not fetched again.
 */
export function PhotoViewer({ items, total, openId, onClose }: PhotoViewerProps) {
  const { t } = useTranslation();
  const isReduced = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext);
  const window = useWindowDimensions();
  const [measured, setMeasured] = useState<Size | null>(null);
  const size: Size = measured ?? { width: window.width, height: window.height };
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.id === openId),
    ),
  );
  // A file taken away under the viewer leaves it on the last one there is.
  const current = Math.min(index, items.length - 1);
  const position = useSharedValue(-current * size.width);
  const titleRef = useRef<View>(null);

  useEffect(() => {
    if (items.length === 0) {
      onClose();
    }
  }, [items.length, onClose]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) {
      setMeasured({ width, height });
      position.set(-current * width);
    }
  };

  const turn = (target: number) => {
    setIndex(target);
    const to = -target * size.width;
    position.set(isReduced ? to : withTiming(to, { duration: SETTLE_MS }));
  };

  const onTurn = useCallback((target: number) => setIndex(target), []);

  const row = useMemo<PageRow>(
    () => ({
      position,
      count: items.length,
      width: size.width,
      height: size.height,
      isReduced,
      onTurn,
    }),
    [position, items.length, size.width, size.height, isReduced, onTurn],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() }] }));
  const pageSize = useMemo(
    () => ({ width: size.width, height: size.height }),
    [size.width, size.height],
  );

  // react-native-web has no sendAccessibilityEvent (confirm-dialog.tsx).
  const focusTitle = () => {
    if (Platform.OS !== 'web' && titleRef.current !== null) {
      AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
    }
  };

  const shown = items[current];
  if (shown === undefined) {
    return null;
  }
  const title =
    shown.kind === 'video'
      ? t('steps.videoName')
      : t('media.viewer.photo', { index: shown.number, total });
  const top = (insets?.top ?? 0) + Spacing.sm;
  const bottom = (insets?.bottom ?? 0) + Spacing.md;

  return (
    <Modal
      testID="photo-viewer"
      visible
      transparent
      animationType={isReduced ? 'none' : 'fade'}
      onRequestClose={onClose}
      onShow={focusTitle}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <StatusBar style="light" />
      <GestureHandlerRootView style={layout.screen} onLayout={onLayout}>
        <View style={layout.screen} accessibilityViewIsModal>
          <Animated.View style={[layout.row, { width: size.width * items.length }, rowStyle]}>
            {items.map((item, at) => {
              const isCurrent = at === current;
              const isDrawn = Math.abs(at - current) <= DRAWN_NEIGHBOURS;
              return (
                <View
                  key={item.id}
                  style={pageSize}
                  // Only the page on screen is there for the reader.
                  importantForAccessibility={isCurrent ? 'auto' : 'no-hide-descendants'}
                  accessibilityElementsHidden={!isCurrent}
                >
                  {item.kind === 'video' ? (
                    isCurrent ? (
                      <ViewerVideo item={item} />
                    ) : null
                  ) : isDrawn ? (
                    <ZoomablePhoto
                      item={item}
                      index={at}
                      isCurrent={isCurrent}
                      total={total}
                      row={row}
                    />
                  ) : null}
                </View>
              );
            })}
          </Animated.View>

          <View style={[layout.top, { paddingTop: top }]} pointerEvents="box-none">
            <View ref={titleRef} accessible accessibilityRole="header" style={layout.title}>
              <Text color={VIEWER.onScrim} weight={600}>
                {title}
              </Text>
            </View>
            <ViewerButton icon="action.close" label={t('common.close')} onPress={onClose} />
          </View>

          {items.length > 1 ? (
            <View style={[layout.bottom, { paddingBottom: bottom }]} pointerEvents="box-none">
              <ViewerButton
                icon="action.back"
                label={t('media.viewer.previous')}
                isDisabled={current === 0}
                onPress={() => turn(current - 1)}
              />
              <ViewerButton
                icon="action.next"
                label={t('media.viewer.next')}
                isDisabled={current === items.length - 1}
                onPress={() => turn(current + 1)}
              />
            </View>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

interface ViewerButtonProps {
  icon: IconMeaning;
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
}

/** A round control over the photo: light on the dark veil, so it reads over a white wall as well. */
function ViewerButton({ icon, label, onPress, isDisabled = false }: ViewerButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      hitSlop={Spacing.xs}
      style={({ pressed }) => [
        layout.button,
        isDisabled && layout.buttonDisabled,
        pressed && layout.buttonPressed,
      ]}
    >
      <Icon name={icon} color={VIEWER.onScrim} />
    </Pressable>
  );
}

const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: VIEWER.background },
  row: { flexDirection: 'row', flex: 1 },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  title: {
    flexShrink: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: VIEWER.scrim,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VIEWER.scrim,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.7 },
});
