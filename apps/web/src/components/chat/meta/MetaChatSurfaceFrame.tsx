import type { ReactNode } from "react";

interface MetaChatSurfaceFrameProps {
  children: ReactNode;
}

export function MetaChatSurfaceFrame({ children }: MetaChatSurfaceFrameProps) {
  return (
    <div className="meta-chat-screen">
      <div className="meta-chat-screen__frame">{children}</div>
    </div>
  );
}
