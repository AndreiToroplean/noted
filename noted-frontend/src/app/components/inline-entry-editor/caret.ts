/**
 * Whether a textarea's caret sits on its first and on its last visual line,
 * wrapped lines included — which a field's own value cannot say, since a long
 * line wraps without a line break in it.
 *
 * The text is laid out again in a hidden copy of the field, with a marker where
 * the caret is, and the marker's line read off its position. Meant for the
 * in-place fields, which have no padding or border of their own.
 */
export function caretLines(field: HTMLTextAreaElement): { first: boolean; last: boolean } {
  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  mirror.style.cssText = `
    position: absolute;
    visibility: hidden;
    inset-block-start: 0;
    inset-inline-start: 0;
    width: ${field.clientWidth}px;
    font: ${style.font};
    letter-spacing: ${style.letterSpacing};
    word-spacing: ${style.wordSpacing};
    line-height: ${style.lineHeight};
    white-space: pre-wrap;
    overflow-wrap: break-word;
  `;
  // The marker holds the character after the caret, so a caret at a wrap reads
  // as the start of the line below, where it is drawn; at the very end, a
  // zero-width space stands in.
  const caret = field.selectionStart;
  const marker = document.createElement('span');
  marker.textContent = field.value[caret] ?? '​';
  mirror.append(field.value.slice(0, caret), marker, field.value.slice(caret + 1));
  document.body.append(mirror);

  const box = mirror.getBoundingClientRect();
  const at = marker.getBoundingClientRect();
  mirror.remove();

  const top = at.top - box.top;
  return { first: top <= at.height / 2, last: top + at.height * 1.5 >= box.height };
}
