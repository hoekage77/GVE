import SceneViewer from "../SceneViewer";
import { InlineArtifactCard } from "./InlineArtifactCard";

interface InlineScenePreviewProps {
  code: string;
  skill: string;
  sceneId: string;
  versionId: string;
  onExpand?: () => void;
}

export function InlineScenePreview({
  code,
  skill,
  sceneId,
  onExpand,
}: InlineScenePreviewProps) {
  return (
    <InlineArtifactCard
      sceneId={sceneId}
      skill={skill}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        <SceneViewer code={code} skill={skill} onExpand={onExpand} />
      </div>
    </InlineArtifactCard>
  );
}
