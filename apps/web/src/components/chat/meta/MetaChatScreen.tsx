import { ChatContainer } from "../ChatContainer";
import { MetaChatSurfaceFrame } from "./MetaChatSurfaceFrame";

export function MetaChatScreen() {
  return (
    <MetaChatSurfaceFrame>
      <ChatContainer />
    </MetaChatSurfaceFrame>
  );
}
