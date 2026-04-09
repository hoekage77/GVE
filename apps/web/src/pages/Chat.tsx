import { useEffect } from 'react';
import { ChatContainer } from "../components/chat/ChatContainer";

export default function ChatPage() {
  useEffect(() => {
    document.title = 'GenVis | Chat';
  }, []);

  return <ChatContainer />;
}
