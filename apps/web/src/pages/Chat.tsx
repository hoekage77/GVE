import { useEffect } from 'react';
import { ChatContainer } from "../components/chat/ChatContainer";
import { MetaChatScreen } from "../components/chat/meta/MetaChatScreen";
import { isMetaChatUiEnabled } from "../lib/features";

const META_CHAT_UI_ENABLED = isMetaChatUiEnabled();

export default function ChatPage() {
  useEffect(() => {
    document.title = 'GenVis | Chat';
  }, []);

  if (META_CHAT_UI_ENABLED) {
    return <MetaChatScreen />;
  }

  return <ChatContainer />;
}
