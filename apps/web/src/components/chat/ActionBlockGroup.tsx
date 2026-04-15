import type { ActionBlock as ActionBlockType } from '../../types/actionBlocks';
import ActionBlock from './ActionBlock';

interface ActionBlockGroupProps {
  blocks: ActionBlockType[];
  messageId?: string;
}

export default function ActionBlockGroup({ blocks, messageId }: ActionBlockGroupProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <div className="action-block-group" role="region" aria-label="Action blocks">
      {blocks.map((block, index) => (
        <ActionBlock key={block.id} block={block} index={index} />
      ))}
    </div>
  );
}
