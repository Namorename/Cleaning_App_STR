import { isSafeHttpsUrl, parseKbMarkup, type KbBlock, type KbLine } from '@str-ops/shared';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { reportError } from '@/lib/sentry';

/**
 * An address of an article, opened in the phone's browser — never inside the
 * app. The reader of the text took it as a link only when it passed
 * `isSafeHttpsUrl`; asked again here, so nothing else is ever opened.
 */
export function openKbLink(href: string): void {
  if (!isSafeHttpsUrl(href)) {
    return;
  }
  Linking.openURL(href).catch((error: unknown) => {
    reportError(error);
  });
}

/** The host a link opens, written beside it: the reader sees where she is going. */
function hostOf(href: string): string {
  return href.replace(/^https:\/\//i, '').split(/[/?#:]/, 1)[0] ?? href;
}

interface LineProps {
  line: KbLine;
  /** The ink of the block it stands in: «Важно» draws its own. */
  color?: string;
}

/** The pieces of one line inside the Text that holds it. */
function Line({ line, color }: LineProps) {
  const { t } = useTranslation();
  return line.map((piece, index) => {
    if (piece.kind === 'bold') {
      return (
        <Text key={index} weight={700} color={color}>
          {piece.text}
        </Text>
      );
    }
    if (piece.kind === 'link') {
      return (
        <Fragment key={index}>
          <Text
            tone="link"
            accessibilityRole="link"
            accessibilityHint={t('knowledge.opensInBrowser')}
            onPress={() => openKbLink(piece.href)}
            style={layout.link}
          >
            {piece.text}
          </Text>
          {piece.text === piece.href ? null : (
            <Text variant="caption" tone="secondary">
              {` (${hostOf(piece.href)})`}
            </Text>
          )}
        </Fragment>
      );
    }
    return piece.text;
  });
}

/** Lines of one block, a line break between them as the author typed. */
function Lines({ lines, color }: { lines: readonly KbLine[]; color?: string }) {
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? '\n' : null}
      <Line line={line} color={color} />
    </Fragment>
  ));
}

interface ItemProps {
  marker: string;
  line: KbLine;
  /** A number is read with its line; a bullet is only drawn — one stop a row. */
  isMarkerRead: boolean;
}

/** A row of a list: its marker, then the line, wrapping under itself. */
function Item({ marker, line, isMarkerRead }: ItemProps) {
  return (
    <View style={layout.item}>
      <Text
        tone="secondary"
        style={layout.marker}
        accessibilityElementsHidden={!isMarkerRead}
        importantForAccessibility={isMarkerRead ? 'auto' : 'no-hide-descendants'}
      >
        {marker}
      </Text>
      <Text style={layout.itemText}>
        <Line line={line} />
      </Text>
    </View>
  );
}

function Block({ block }: { block: KbBlock }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // «Важно» in the urgent tone, as the panel draws it.
  const ink = useTheme().tone.urgent.fg;

  switch (block.kind) {
    case 'paragraph':
      return (
        <Text>
          <Lines lines={block.lines} />
        </Text>
      );
    case 'bullets':
      return (
        <View style={layout.list}>
          {block.items.map((item, index) => (
            <Item key={index} marker="•" line={item} isMarkerRead={false} />
          ))}
        </View>
      );
    case 'numbered':
      return (
        <View style={layout.list}>
          {block.items.map((item, index) => (
            <Item key={index} marker={`${block.start + index}.`} line={item} isMarkerRead />
          ))}
        </View>
      );
    case 'steps':
      return (
        <View style={layout.steps}>
          {block.items.map((item, index) => (
            <View key={index} style={layout.step}>
              <Text variant="title" tone="primary">
                {t('knowledge.step', { number: block.start + index })}
              </Text>
              <Text>
                <Line line={item} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'important':
      return (
        <View testID="kb-important" style={styles.important}>
          <Text weight={700} color={ink}>
            {t('knowledge.important')}
          </Text>
          <Text color={ink}>
            <Lines lines={block.lines} color={ink} />
          </Text>
        </View>
      );
  }
}

interface KbBodyProps {
  /** The article's text as its author wrote it, marks and all. */
  body: string;
}

/**
 * An article's text, drawn from the shared reader (`parseKbMarkup`, the same
 * the panel's preview reads): paragraphs, bold, lists, numbered lists, steps,
 * «Важно» in the urgent tone as the panel draws it, https links that open the
 * phone's browser. No HTML anywhere: what is not a mark stays the text it is.
 */
export function KbBody({ body }: KbBodyProps) {
  const blocks = useMemo(() => parseKbMarkup(body), [body]);

  return (
    <View style={layout.body}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </View>
  );
}

/** The narrowest a list's marker is drawn: two digits and a dot. */
const MARKER_WIDTH = 24;

/** The width of the stripe that marks «Важно», as the panel's. */
const IMPORTANT_STRIPE = 4;

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  body: { gap: Spacing.md },
  list: { gap: Spacing.xs },
  item: { flexDirection: 'row', gap: Spacing.sm },
  // Room for «10.», so the lines of a list start in one column.
  marker: { minWidth: MARKER_WIDTH },
  itemText: { flex: 1 },
  steps: { gap: Spacing.md },
  step: { gap: Spacing.xs },
  link: { textDecorationLine: 'underline' },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    important: {
      gap: Spacing.xs,
      padding: Spacing.md,
      borderRadius: Radius.md,
      borderLeftWidth: IMPORTANT_STRIPE,
      borderLeftColor: theme.tone.urgent.border,
      backgroundColor: theme.tone.urgent.bg,
    },
  });
