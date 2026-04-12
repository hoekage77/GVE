import type { ReactNode } from "react";

interface MetaThreadScaffoldProps {
  children: ReactNode;
}

export function MetaThreadScaffold({ children }: MetaThreadScaffoldProps) {
  return (
    <section className="meta-chat-thread-scaffold" aria-label="Meta chat thread scaffold">
      {children}
    </section>
  );
}
