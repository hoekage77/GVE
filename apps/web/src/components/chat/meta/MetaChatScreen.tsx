import { ChatContainer } from "../ChatContainer";
import { MetaChatTopBar } from "./MetaChatTopBar";
import { MetaThreadScaffold } from "./MetaThreadScaffold";
import { MetaComposerScaffold } from "./MetaComposerScaffold";
import { MetaChatSurfaceFrame } from "./MetaChatSurfaceFrame";

export function MetaChatScreen() {
  return (
    <MetaChatSurfaceFrame>
      <MetaChatTopBar />

      <MetaThreadScaffold>
        <ChatContainer variant="meta" />
      </MetaThreadScaffold>

      <MetaComposerScaffold />
    </MetaChatSurfaceFrame>
  );
}
