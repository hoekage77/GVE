import { Link2 } from "lucide-react";

export interface SourceResult {
  label: string;
  url: string;
}

interface SourceResultsListProps {
  sources: SourceResult[];
}

export function SourceResultsList({ sources }: SourceResultsListProps) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section className="mt-2" aria-label="Linked sources">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">Sources</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <a
            key={source.url}
            className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.04] px-2 py-1 text-[11px] text-white/75 transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.url}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{source.label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
