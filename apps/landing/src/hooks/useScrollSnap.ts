import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

type SnapRange = {
  start: number;
  end: number;
  center: number;
};

const READY_DELAY_MS = 500;
const SNAP_BUFFER = 0.02;

gsap.registerPlugin(ScrollTrigger);

export function useScrollSnap() {
  useEffect(() => {
    let snapTrigger: ReturnType<typeof ScrollTrigger.create> | null = null;

    const timer = window.setTimeout(() => {
      const pinned = ScrollTrigger.getAll()
        .filter((trigger) => trigger.vars.pin)
        .sort((left, right) => left.start - right.start);

      const maxScroll = ScrollTrigger.maxScroll(window);

      if (!maxScroll || pinned.length === 0) {
        return;
      }

      const pinnedRanges: SnapRange[] = pinned.map((trigger) => {
        const start = trigger.start / maxScroll;
        const rangeEnd = trigger.end ?? trigger.start;
        const end = rangeEnd / maxScroll;

        return {
          start,
          end,
          center: (trigger.start + (rangeEnd - trigger.start) * 0.5) / maxScroll,
        };
      });

      snapTrigger = ScrollTrigger.create({
        snap: {
          snapTo: (value: number) => {
            const inPinnedRange = pinnedRanges.some(
              (range) => value >= range.start - SNAP_BUFFER && value <= range.end + SNAP_BUFFER,
            );

            if (!inPinnedRange) {
              return value;
            }

            return pinnedRanges.reduce(
              (closest, range) =>
                Math.abs(range.center - value) < Math.abs(closest - value) ? range.center : closest,
              pinnedRanges[0]?.center ?? 0,
            );
          },
          duration: { min: 0.15, max: 0.35 },
          delay: 0,
          ease: 'power2.out',
        },
      });
    }, READY_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      snapTrigger?.kill();
    };
  }, []);
}