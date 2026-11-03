import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';

// WebKit paints a line-sized caret, including the height of inline images.
// Keep the native selection/editing machinery; replace only its painted caret.
export const SafariCaret = Extension.create({
  name: 'safariCaret',
  addProseMirrorPlugins() {
    if (
      !/AppleWebKit/.test(navigator.userAgent) ||
      /Chrome|Chromium|Edg|OPR|Android/.test(navigator.userAgent)
    )
      return [];
    return [
      new Plugin({
        view(view) {
          const doc = view.dom.ownerDocument;
          const win = doc.defaultView!;
          const caret = doc.createElement('div');
          caret.className = 'safari-text-caret';
          caret.setAttribute('aria-hidden', 'true');
          caret.hidden = true;
          doc.body.append(caret);
          let frame = 0;
          const hide = () => {
            caret.hidden = true;
            view.dom.classList.remove('safari-caret-active');
          };
          const update = () => {
            frame = 0;
            const selection = doc.getSelection();
            const node = selection?.focusNode;
            const element =
              node instanceof Element ? node : node?.parentElement;
            if (
              !view.editable ||
              !view.hasFocus() ||
              !doc.hasFocus() ||
              view.composing ||
              !(view.state.selection instanceof TextSelection) ||
              !view.state.selection.empty ||
              !selection?.isCollapsed ||
              !selection.rangeCount ||
              !element ||
              !view.dom.contains(element) ||
              element.closest('pre')
            ) {
              hide();
              return;
            }
            let native = selection.getRangeAt(0).getBoundingClientRect();
            if (!native.height) {
              const coords = view.coordsAtPos(view.state.selection.from);
              native = new DOMRect(
                coords.left,
                coords.top,
                coords.right - coords.left,
                coords.bottom - coords.top,
              );
            }
            const style = win.getComputedStyle(element);
            let height = parseFloat(style.fontSize) * 1.2;
            let top = native.bottom - height;
            // Read the adjacent glyph baseline. Safari can also inflate a text
            // range to the line height, so cap its height using the local font.
            if (node?.nodeType === Node.TEXT_NODE && node.textContent?.length) {
              const offset = selection.focusOffset;
              const glyph = doc.createRange();
              glyph.setStart(node, offset ? offset - 1 : 0);
              glyph.setEnd(node, offset || 1);
              let rect = glyph.getBoundingClientRect();
              // At a soft wrap the same DOM offset can belong to either row.
              // Match the native caret's row instead of jumping to the prior one.
              if (offset && offset < node.textContent.length) {
                glyph.setStart(node, offset);
                glyph.setEnd(node, offset + 1);
                const next = glyph.getBoundingClientRect();
                if (
                  Math.abs(next.bottom - native.bottom) <
                  Math.abs(rect.bottom - native.bottom)
                )
                  rect = next;
              }
              if (rect.height) {
                height = Math.min(rect.height, height);
                top = rect.bottom - height;
              }
            }
            const viewport = view.dom.closest('.writing-scroll') || view.dom;
            const bounds = viewport.getBoundingClientRect();
            const bottom = Math.min(
              top + height,
              bounds.bottom,
              win.innerHeight,
            );
            top = Math.max(top, bounds.top, 0);
            if (
              !native.height ||
              bottom <= top ||
              native.left < bounds.left ||
              native.left > bounds.right
            ) {
              hide();
              return;
            }
            caret.style.left = `${native.left}px`;
            caret.style.top = `${top}px`;
            caret.style.height = `${bottom - top}px`;
            caret.style.backgroundColor = style.color;
            // Restart blinking on movement without recreating the DOM node.
            caret
              .getAnimations()
              .forEach((animation) => (animation.currentTime = 0));
            caret.hidden = false;
            view.dom.classList.add('safari-caret-active');
          };
          const schedule = () => {
            if (!frame) frame = win.requestAnimationFrame(update);
          };
          const events = [
            'selectionchange',
            'visibilitychange',
            'scroll',
            'focusin',
            'focusout',
            'compositionstart',
            'compositionend',
          ] as const;
          events.forEach((event) =>
            doc.addEventListener(event, schedule, true),
          );
          win.addEventListener('resize', schedule);
          win.addEventListener('blur', hide);
          win.addEventListener('focus', schedule);
          const resize = new ResizeObserver(schedule);
          resize.observe(view.dom);
          schedule();
          return {
            update: schedule,
            destroy() {
              win.cancelAnimationFrame(frame);
              resize.disconnect();
              events.forEach((event) =>
                doc.removeEventListener(event, schedule, true),
              );
              win.removeEventListener('resize', schedule);
              win.removeEventListener('blur', hide);
              win.removeEventListener('focus', schedule);
              hide();
              caret.remove();
            },
          };
        },
      }),
    ];
  },
});
