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
    <section className="meta-results" aria-label="Linked sources">
      <p className="meta-results__heading">Sources</p>
      <div className="meta-results__list">
        {sources.map((source) => (
          <a
            key={source.url}
            className="meta-results__item"
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
