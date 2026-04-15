import { Globe, Layers3, ShieldAlert, Wrench } from "lucide-react";
import type { SceneAssetPlan } from "@visual-runtime/shared";

interface AssetPlanSummaryProps {
  assetPlan?: SceneAssetPlan | null;
  sceneId?: string | null;
}

function toReadableLabel(value: string): string {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (token) => token.toUpperCase());
}

function buildFallbackCopy(plan: SceneAssetPlan): string {
  const policy = plan.fallbackPolicy;
  const internet = policy.allowInternetFallback ? "Internet fallback enabled" : "Internet fallback disabled";
  const warning = policy.requireFallbackWarning ? "warning required" : "warning optional";
  const inlineComment = policy.requireInlineFallbackComment ? "inline reason required" : "inline reason optional";

  return `${internet} · ${warning} · ${inlineComment}`;
}

export default function AssetPlanSummary({ assetPlan, sceneId }: AssetPlanSummaryProps) {
  if (!assetPlan) {
    return null;
  }

  const categories = Array.isArray(assetPlan.categories) ? assetPlan.categories.slice(0, 6) : [];
  const helpers = Array.isArray(assetPlan.runtimeHelpers) ? assetPlan.runtimeHelpers.slice(0, 4) : [];
  const curatedCandidates = Array.isArray(assetPlan.curatedCandidates)
    ? assetPlan.curatedCandidates.slice(0, 4)
    : [];

  return (
    <section className="terranet-asset-plan" aria-label="Resolved asset plan">
      <header className="terranet-asset-plan__header">
        <div className="terranet-asset-plan__title-wrap">
          <Layers3 className="h-4 w-4" aria-hidden="true" />
          <p className="terranet-asset-plan__title">Asset Plan</p>
        </div>
        <span className={`terranet-asset-plan__strategy terranet-asset-plan__strategy--${assetPlan.strategy}`}>
          {toReadableLabel(assetPlan.strategy)}
        </span>
      </header>

      <div className="terranet-asset-plan__meta-row">
        <span className="terranet-asset-plan__meta-pill">Quality: {toReadableLabel(assetPlan.requestedQuality)}</span>
        <span className="terranet-asset-plan__meta-pill">Skill: {toReadableLabel(assetPlan.skill)}</span>
        {sceneId ? <span className="terranet-asset-plan__meta-pill">Scene: {sceneId}</span> : null}
      </div>

      {categories.length > 0 && (
        <div className="terranet-asset-plan__group">
          <p className="terranet-asset-plan__label">Categories</p>
          <div className="terranet-asset-plan__chips">
            {categories.map((category) => (
              <span key={category} className="terranet-asset-plan__chip">
                {toReadableLabel(category)}
              </span>
            ))}
          </div>
        </div>
      )}

      {curatedCandidates.length > 0 && (
        <div className="terranet-asset-plan__group">
          <p className="terranet-asset-plan__label">Curated Candidates</p>
          <ul className="terranet-asset-plan__candidate-list">
            {curatedCandidates.map((candidate) => (
              <li key={`${candidate.id}-${candidate.url}`} className="terranet-asset-plan__candidate-item">
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noreferrer"
                  className="terranet-asset-plan__candidate-link"
                  title={candidate.note || candidate.id}
                >
                  {candidate.id}
                </a>
                {candidate.note ? <span className="terranet-asset-plan__candidate-note">{candidate.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="terranet-asset-plan__group terranet-asset-plan__group--policy">
        <p className="terranet-asset-plan__label">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Fallback Policy
        </p>
        <p className="terranet-asset-plan__policy-copy">
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          {buildFallbackCopy(assetPlan)}
        </p>
        {helpers.length > 0 && (
          <p className="terranet-asset-plan__policy-copy">
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            Runtime helpers: {helpers.join(", ")}
          </p>
        )}
      </div>
    </section>
  );
}
