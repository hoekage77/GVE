import { memo } from "react";
import SceneViewer from "../SceneViewer";
import { InlineArtifactCard } from "./InlineArtifactCard";

interface InlineScenePreviewProps {
  code: string;
  skill: string;
  sceneId: string;
  versionId: string;
  onExpand?: () => void;
  streaming?: boolean;
}

const InlineScenePreviewInner = memo(function InlineScenePreviewInner({
  code,
  skill,
  sceneId,
  versionId,
  onExpand,
  streaming = false,
}: InlineScenePreviewProps) {
  return (
    <InlineArtifactCard
      sceneId={sceneId}
      skill={skill}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        <SceneViewer key={`inline-${versionId}-${sceneId}`} code={code} skill={skill} onExpand={onExpand} streaming={streaming} />
      </div>
    </InlineArtifactCard>
  );
}, (prev, next) => {
  return (
    prev.code === next.code &&
    prev.skill === next.skill &&
    prev.sceneId === next.sceneId &&
    prev.versionId === next.versionId &&
    prev.streaming === next.streaming
  );
});

export function InlineScenePreview(props: InlineScenePreviewProps) {
  return <InlineScenePreviewInner {...props} />;
}
