import { useCallback, useEffect, useRef, useState } from 'react';

interface TooltipPos {
  x: number;
  y: number;
  visible: boolean;
  text: string;
}

const TARGETS = [
  { id: 't1', label: 'PALOCERAS' },
  { id: 't2', label: 'SHOP ALL' },
  { id: 't3', label: 'LOOKS' },
  { id: 't4', label: 'BESPOKE' },
  { id: 't5', label: 'BRAND' },
  { id: 't6', label: 'BOUTIQUES' },
  { id: 't7', label: 'ACCOUNT' },
  { id: 't8', label: 'Cart' },
  { id: 't9', label: 'PEBBLE COLLECTION' },
  { id: 't10', label: 'Discover' }
] as const;

export default function BrowserPreview({ extractMode = true }: { extractMode?: boolean }) {
  const highlightsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipPos>({ x: 0, y: 0, visible: false, text: '' });

  const moveTip = useCallback((n: number) => {
    const h = highlightsRef.current?.querySelector(`[data-id="${Math.min(n, 10)}"]`) as HTMLElement;
    if (!h || !highlightsRef.current) return;

    const bh = highlightsRef.current.getBoundingClientRect();
    const rh = h.getBoundingClientRect();

    setTooltip({
      x: rh.left - bh.left + rh.width / 2 - 75,
      y: rh.top - bh.top - 44,
      visible: true,
      text: `Extracting link #${n}...`
    });
  }, []);

  const layoutHighlights = useCallback(() => {
    if (!highlightsRef.current || !containerRef.current) return;

    highlightsRef.current.innerHTML = '';
    const base = highlightsRef.current.getBoundingClientRect();

    TARGETS.forEach((target, i) => {
      const el = document.getElementById(target.id);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const pad = i === 0 ? 10 : 8;

      const h = document.createElement('div');
      h.className = 'highlight';
      h.dataset.id = String(i + 1);
      h.style.left = (rect.left - base.left - pad / 2) + 'px';
      h.style.top = (rect.top - base.top - pad / 2) + 'px';
      h.style.width = (rect.width + pad) + 'px';
      h.style.height = (rect.height + pad) + 'px';
      h.style.opacity = extractMode ? '0.7' : '0';
      h.style.transition = 'opacity 0.3s, transform 0.2s';

      h.addEventListener('click', () => {
        if (extractMode) {
          h.classList.add('flash');
          setTimeout(() => h.classList.remove('flash'), 600);
          moveTip(i + 1);
        }
      });

      if (highlightsRef.current) {
        highlightsRef.current.appendChild(h);
      }
    });
  }, [extractMode, moveTip]);

  useEffect(() => {
    layoutHighlights();
    window.addEventListener('resize', layoutHighlights);
    return () => window.removeEventListener('resize', layoutHighlights);
  }, [layoutHighlights]);

  useEffect(() => {
    if (!highlightsRef.current) return;
    highlightsRef.current.querySelectorAll('.highlight').forEach(h => {
      (h as HTMLElement).style.opacity = extractMode ? '0.7' : '0';
    });
    if (!extractMode) {
      setTooltip(p => ({ ...p, visible: false }));
    }
  }, [extractMode]);

  return (
    <section className="flex-1 p-2 sm:p-3 lg:p-4 min-h-[56vh] xl:min-h-0">
      <div
        ref={containerRef}
        className="relative h-full w-full rounded-[28px] overflow-hidden bg-black border border-white/10 shadow-[0_0_0_1px_#000,0_30px_80px_-30px_#000]"
      >
        {/* Background */}
        <div className="absolute inset-0">
          <img
            src="https://images.unsplash.com/photo-1508296695146-257a814070b4?q=80&w=2400&auto=format&fit=crop"
            className="w-full h-full object-cover object-center"
            alt=""
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/50 to-black/90"></div>
          <div className="absolute inset-0 bg-[#050507]/60"></div>
        </div>

        {/* Content */}
        <div className="relative z-10 h-full flex flex-col">
          {/* Fake site nav */}
          <nav className="flex items-center justify-between px-6 md:px-12 py-7">
            <div className="flex items-center gap-10">
              <div id="t1" className="text-[26px] md:text-[30px] font-bold tracking-[0.18em]">
                PALOCERAS
              </div>
              <div className="hidden lg:flex items-center gap-8 text-[13px] font-medium tracking-wide text-white/75">
                <a id="t2" className="hover:text-white cursor-pointer">
                  SHOP ALL
                </a>
                <a id="t3" className="hover:text-white cursor-pointer">
                  LOOKS
                </a>
                <a id="t4" className="hover:text-white cursor-pointer">
                  BESPOKE
                </a>
                <a id="t5" className="hover:text-white cursor-pointer">
                  BRAND
                </a>
                <a id="t6" className="hover:text-white cursor-pointer">
                  BOUTIQUES
                </a>
              </div>
            </div>
            <div className="flex items-center gap-6 text-[13px] font-medium text-white/75">
              <a id="t7" className="hidden sm:block hover:text-white cursor-pointer">
                ACCOUNT
              </a>
              <button id="t8" className="w-9 h-9 grid place-items-center rounded-full border border-white/20 hover:border-white/40 transition">
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M2 3h3l1 6h9l2-4H6m0 0l-.8-2M8 15a1 1 0 100 2 1 1 0 000-2zm8 0a1 1 0 100 2 1 1 0 000-2z" />
                </svg>
              </button>
            </div>
          </nav>

          {/* Hero */}
          <div className="flex-1 flex items-end px-6 md:px-12 pb-14">
            <div>
              <div className="flex items-center gap-3 mb-5">
                <span id="t9" className="inline-block text-[13px] tracking-[0.25em] text-white/60">
                  PEBBLE COLLECTION
                </span>
                <span className="text-[13px] tracking-[0.25em] text-white/30">2024</span>
              </div>
              <h1 className="text-[56px] md:text-[84px] leading-[0.85] font-semibold tracking-tighter">
                PALOCERAS
              </h1>
              <h2 className="text-[56px] md:text-[84px] leading-[0.85] font-semibold tracking-tighter text-white/60 mb-10">
                PEBBLE
              </h2>
              <button
                id="t10"
                className="group inline-flex items-center gap-2 text-[14px] font-medium text-white/90 hover:text-white"
              >
                Discover <span className="transition group-hover:translate-x-1">→</span>
              </button>
            </div>
          </div>
        </div>

        {/* Highlights layer */}
        <div
          ref={highlightsRef}
          id="highlights"
          className="absolute inset-0 z-20 pointer-events-none"
        />

        {/* Tooltip */}
        <div
          id="tip"
          className="absolute z-40 transition-all duration-500 pointer-events-none"
          style={{
            left: tooltip.x + 'px',
            top: tooltip.y + 'px',
            opacity: tooltip.visible && extractMode ? 1 : 0
          }}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#06131e]/95 border border-sky-400/50 shadow-[0_8px_30px_rgba(0,0,0,.6)] backdrop-blur-md">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-sky-400/30 border-t-sky-400 animate-spin"></div>
            <span className="text-[12px] font-medium text-sky-300 tracking-wide whitespace-nowrap">
              {tooltip.text}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// Global styles for highlights
const highlightStyles = `
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(56, 189, 248, .7), inset 0 0 0 1px rgba(125, 211, 252, .9);
    }
    70% {
      box-shadow: 0 0 0 12px rgba(56, 189, 248, 0), inset 0 0 0 1px rgba(125, 211, 252, .9);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(56, 189, 248, 0), inset 0 0 0 1px rgba(125, 211, 252, .9);
    }
  }
  
  .highlight {
    position: absolute;
    border-radius: 12px;
    background: rgba(14, 165, 233, .1);
    border: 1.5px solid #38bdf8;
    animation: pulse 2s infinite;
    pointer-events: auto;
    cursor: pointer;
    z-index: 30;
  }
  
  .highlight.flash {
    animation: none !important;
    border-color: #fff !important;
    background: rgba(255, 255, 255, .2) !important;
    transform: scale(1.04);
    box-shadow: 0 0 30px rgba(56, 189, 248, .8) !important;
  }
`;

// Inject styles
if (typeof window !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = highlightStyles;
  document.head.appendChild(style);
}
