import type { ActionBlock as ActionBlockType } from '../../types/actionBlocks';
import ActionBlock from './ActionBlock';

interface ActionBlockGroupProps {
  blocks: ActionBlockType[];
}

export default function ActionBlockGroup({ blocks }: ActionBlockGroupProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  return (
    <div className="my-4 flex flex-col gap-3 overflow-hidden rounded-md" role="region" aria-label="Action blocks">
      {blocks.map((block) => (
        <ActionBlock key={block.id} block={block} />
      ))}
    </div>
  );
}
