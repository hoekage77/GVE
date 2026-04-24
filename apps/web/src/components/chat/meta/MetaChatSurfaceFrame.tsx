import type { ReactNode } from "react";

interface MetaChatSurfaceFrameProps {
  children: ReactNode;
}

export function MetaChatSurfaceFrame({ children }: MetaChatSurfaceFrameProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-stretch justify-stretch bg-transparent">
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-transparent">{children}</div>
    </div>
  );
}
