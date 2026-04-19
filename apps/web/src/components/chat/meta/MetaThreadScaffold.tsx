import type { ReactNode } from "react";

interface MetaThreadScaffoldProps {
  children: ReactNode;
}

export function MetaThreadScaffold({ children }: MetaThreadScaffoldProps) {
  return (
    <section className="flex min-h-0 flex-1 overflow-hidden" aria-label="Meta chat thread scaffold">
      <div className="flex min-h-0 w-full flex-1 flex-col bg-transparent lg:flex-row">{children}</div>
    </section>
  );
}
