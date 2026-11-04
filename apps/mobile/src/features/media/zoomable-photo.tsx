import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Text } from '@/components/text';
import { Colors, Spacing } from '@/constants/theme';

import { reportMediaNotShown } from './display-failure';
import { mediaFileUri } from './media-path';
import type { ViewerItem } from './viewer-items';

/** As close as two fingers may take a photo. */
export const MAX_SCALE = 4;
/** Where a double tap takes it, around the tapped point. */
export const DOUBLE_TAP_SCALE = 2.5;
/** How far below its own size a pinch may go before it springs back. */
const MIN_PINCH_SCALE = 0.8;
/** Under this a photo is at its own size: the finger pages instead of moving it. */
const ZOOM_EPSILON = 0.01;
/** A swipe past this share of the width, or this fast, turns the page. */
const SWIPE_SHARE = 0.25;
const SWIPE_VELOCITY = 800;
/** Past the first or the last photo, the row follows the finger at a third of its pace. */
const EDGE_RESISTANCE = 3;
const SETTLE_MS = 200;
/** Between the two taps of a double tap. */
const DOUBLE_TAP_DELAY_MS = 250;
/**
 * The photo on screen is decoded for a box this many times the screen's,
 * then drawn at the screen's size: sharp up to 2×, softer beyond. Its
 * neighbours, there only for a swipe to find, are decoded at the screen's.
 */
const RENDER_SCALE = 2;

/** The row of pages the viewer slides, and where it stands. */
export interface PageRow {
  /** The row's offset in points: −index × width at rest. */
  position: SharedValue<number>;
  count: number;
  width: number;
  height: number;
  /** Instant moves when the phone asks for less motion. */
  isReduced: boolean;
  /** A swipe settled on another page. */
  onTurn: (index: number) => void;
}

interface ZoomablePhotoProps {
  item: ViewerItem;
  /** This page's place in the row. */
  index: number;
  /** Whether this page is the one on screen; a page swiped away goes back to its own size. */
  isCurrent: boolean;
  total: number;
  row: PageRow;
}

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/**
 * One photo of the viewer, the size of the screen: two fingers bring it
 * closer and a double tap takes it to 2.5× around the tap or back; a closer
 * photo moves under one finger and stops at its edges. At its own size the
 * finger turns the page instead, and the row follows it.
 *
 * Gesture handler and Reanimated, both in the native build since 1.2.0
 * (dab5237): the zoom runs on the UI thread, and nothing here needs a module
 * the build does not have.
 */
export function ZoomablePhoto({ item, index, isCurrent, total, row }: ZoomablePhotoProps) {
  const { t } = useTranslation();
  // The source that would not show: a renewed link is tried again.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const isMovingPhoto = useSharedValue(false);
  /** Width over height of the picture, once it has loaded; 0 until then. */
  const aspect = useSharedValue(0);
  const uri = mediaFileUri(item.uri);
  const hasFailed = failedUri === uri;

  // A page that is no longer on screen comes back at its own size.
  useEffect(() => {
    if (!isCurrent) {
      scale.set(1);
      offsetX.set(0);
      offsetY.set(0);
    }
  }, [isCurrent, scale, offsetX, offsetY]);

  const { position, count, width, height, isReduced, onTurn } = row;

  const gesture = useMemo(() => {
    /** Where a value goes: at once when the phone asks for less motion. */
    const toward = (target: number) => {
      'worklet';
      return isReduced ? target : withTiming(target, { duration: SETTLE_MS });
    };
    const rest = -index * width;

    /** How far a photo at this scale may move from the centre before its edge leaves the screen's. */
    const limits = (at: number): readonly [number, number] => {
      'worklet';
      const ratio = aspect.get();
      let fitWidth = width;
      let fitHeight = height;
      if (ratio > 0 && width / height > ratio) {
        fitWidth = height * ratio;
      } else if (ratio > 0) {
        fitHeight = width / ratio;
      }
      return [Math.max(0, (fitWidth * at - width) / 2), Math.max(0, (fitHeight * at - height) / 2)];
    };

    const settle = () => {
      'worklet';
      if (scale.get() <= 1) {
        scale.set(toward(1));
        offsetX.set(toward(0));
        offsetY.set(toward(0));
        return;
      }
      const [maxX, maxY] = limits(scale.get());
      offsetX.set(toward(clamp(offsetX.get(), -maxX, maxX)));
      offsetY.set(toward(clamp(offsetY.get(), -maxY, maxY)));
    };

    const turnTo = (target: number) => {
      'worklet';
      position.set(toward(-target * width));
      if (target !== index) {
        scheduleOnRN(onTurn, target);
      }
    };

    const pinch = Gesture.Pinch()
      .withTestId(`viewer-pinch-${item.id}`)
      .onStart((event) => {
        savedScale.set(scale.get());
        savedX.set(offsetX.get());
        savedY.set(offsetY.get());
        focalX.set(event.focalX - width / 2);
        focalY.set(event.focalY - height / 2);
      })
      .onUpdate((event) => {
        const from = savedScale.get();
        const next = clamp(from * event.scale, MIN_PINCH_SCALE, MAX_SCALE);
        const grown = next / from;
        // The point under the fingers stays under them while they move.
        scale.set(next);
        offsetX.set(event.focalX - width / 2 - grown * (focalX.get() - savedX.get()));
        offsetY.set(event.focalY - height / 2 - grown * (focalY.get() - savedY.get()));
      })
      .onEnd(() => {
        settle();
      });

    const pan = Gesture.Pan()
      .withTestId(`viewer-pan-${item.id}`)
      .maxPointers(1)
      .onStart(() => {
        savedX.set(offsetX.get());
        savedY.set(offsetY.get());
        isMovingPhoto.set(scale.get() > 1 + ZOOM_EPSILON);
      })
      .onUpdate((event) => {
        if (isMovingPhoto.get()) {
          offsetX.set(savedX.get() + event.translationX);
          offsetY.set(savedY.get() + event.translationY);
          return;
        }
        const isPastEdge =
          (index === 0 && event.translationX > 0) ||
          (index === count - 1 && event.translationX < 0);
        position.set(
          rest + (isPastEdge ? event.translationX / EDGE_RESISTANCE : event.translationX),
        );
      })
      .onEnd((event, success) => {
        if (isMovingPhoto.get()) {
          // A second finger took over: the pinch settles the photo itself.
          if (!success) {
            return;
          }
          const [maxX, maxY] = limits(scale.get());
          const isInside = Math.abs(offsetX.get()) <= maxX && Math.abs(offsetY.get()) <= maxY;
          if (isInside && !isReduced) {
            offsetX.set(withDecay({ velocity: event.velocityX, clamp: [-maxX, maxX] }));
            offsetY.set(withDecay({ velocity: event.velocityY, clamp: [-maxY, maxY] }));
          } else {
            settle();
          }
          return;
        }
        const isForward =
          event.translationX < -width * SWIPE_SHARE || event.velocityX < -SWIPE_VELOCITY;
        const isBack = event.translationX > width * SWIPE_SHARE || event.velocityX > SWIPE_VELOCITY;
        if (success && isForward && index < count - 1) {
          turnTo(index + 1);
        } else if (success && isBack && index > 0) {
          turnTo(index - 1);
        } else {
          turnTo(index);
        }
      });

    const doubleTap = Gesture.Tap()
      .withTestId(`viewer-double-tap-${item.id}`)
      .numberOfTaps(2)
      .maxDelay(DOUBLE_TAP_DELAY_MS)
      .onEnd((event, success) => {
        if (!success) {
          return;
        }
        if (scale.get() > 1 + ZOOM_EPSILON) {
          scale.set(toward(1));
          offsetX.set(toward(0));
          offsetY.set(toward(0));
          return;
        }
        // The tapped point stays where it was: from a photo at its own size,
        // it moves out by the zoom.
        const [maxX, maxY] = limits(DOUBLE_TAP_SCALE);
        const x = (event.x - width / 2) * (1 - DOUBLE_TAP_SCALE);
        const y = (event.y - height / 2) * (1 - DOUBLE_TAP_SCALE);
        scale.set(toward(DOUBLE_TAP_SCALE));
        offsetX.set(toward(clamp(x, -maxX, maxX)));
        offsetY.set(toward(clamp(y, -maxY, maxY)));
      });

    return Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [
    item.id,
    position,
    count,
    width,
    height,
    isReduced,
    onTurn,
    index,
    scale,
    savedScale,
    offsetX,
    offsetY,
    savedX,
    savedY,
    focalX,
    focalY,
    isMovingPhoto,
    aspect,
  ]);

  const photoStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.get() },
      { translateY: offsetY.get() },
      { scale: scale.get() },
    ],
  }));

  const renderScale = isCurrent ? RENDER_SCALE : 1;
  const canvas = useMemo(
    () => ({
      width: width * renderScale,
      height: height * renderScale,
      left: (width - width * renderScale) / 2,
      top: (height - height * renderScale) / 2,
      transform: [{ scale: 1 / renderScale }],
    }),
    [width, height, renderScale],
  );

  const label = t('media.viewer.photo', { index: item.number, total });

  // Under the same gestures either way: a page that would not show is still
  // swiped past.
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={layout.page}
        accessible
        accessibilityRole={hasFailed ? undefined : 'image'}
        accessibilityLabel={label}
        collapsable={false}
      >
        {hasFailed ? (
          <Text align="center" color={Colors.dark.text} style={layout.failed}>
            {t('media.viewer.photoFailed')}
          </Text>
        ) : (
          <>
            {/* Under the picture: covered the moment the picture is drawn. */}
            <ActivityIndicator color={Colors.dark.textSecondary} style={layout.spinner} />
            <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>
              {/* Decoded for a box larger than the screen and drawn at its
                  size: a closer look stays sharp, and a manager's
                  48-megapixel photo in the chat is still cut down to a size
                  the phone can draw. */}
              <View testID={`viewer-canvas-${item.id}`} style={[layout.canvas, canvas]}>
                <Image
                  testID="viewer-photo"
                  source={{ uri }}
                  contentFit="contain"
                  recyclingKey={item.id}
                  style={StyleSheet.absoluteFill}
                  onLoad={(event) => {
                    const { source } = event;
                    aspect.set(source.height > 0 ? source.width / source.height : 0);
                  }}
                  onError={(event) => {
                    setFailedUri(uri);
                    reportMediaNotShown({
                      mediaId: item.id,
                      kind: 'photo',
                      surface: 'viewer',
                      uri,
                      message: event.error,
                    });
                  }}
                />
              </View>
            </Animated.View>
          </>
        )}
      </View>
    </GestureDetector>
  );
}

/** Sizes only; the viewer is dark in either theme. */
const layout = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  spinner: { position: 'absolute' },
  canvas: { position: 'absolute' },
  failed: { padding: Spacing.xl },
});
