import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Clapperboard, Sparkles } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useChatStore } from '../stores';

interface SceneRow {
  sessionId: string;
  sceneId: string;
  versionId: string;
  version: number;
  skill: string;
  outputKind: 'code' | 'media';
  updatedAt: string;
  isActive: boolean;
}

function compactSceneLabel(sceneId: string): string {
  const normalized = String(sceneId ?? '').trim();
  if (!normalized) {
    return 'Scene';
  }

  if (normalized.length <= 16) {
    return normalized;
  }

  if (normalized.startsWith('scene-')) {
    return `scene-${normalized.slice(-6)}`;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return 'Unknown';
  }

  const deltaMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (deltaMinutes < 1) {
    return 'Just now';
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  return new Date(value).toLocaleDateString();
}

export default function ScenesPage() {
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const selectSession = useChatStore((state) => state.selectSession);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'GenVis | Scenes';
  }, []);

  const sceneRows = useMemo(() => {
    const rows: SceneRow[] = [];

    for (const session of sessions) {
      const versions = (session.sceneVersions && session.sceneVersions.length > 0)
        ? session.sceneVersions
        : (session.currentScene ? [session.currentScene] : []);

      for (const version of versions) {
        if (!version?.versionId) {
          continue;
        }

        rows.push({
          sessionId: session.sessionId,
          sceneId: version.sceneId ?? session.sceneId ?? 'scene',
          versionId: version.versionId,
          version: Number(version.version ?? 0),
          skill: String(version.skill ?? 'auto'),
          outputKind: version.outputKind === 'media' ? 'media' : 'code',
          updatedAt: String(version.updatedAt ?? session.updatedAt),
          isActive: session.sessionId === activeSessionId && session.currentScene?.versionId === version.versionId,
        });
      }
    }

    rows.sort((left, right) => {
      const leftTs = Date.parse(left.updatedAt) || 0;
      const rightTs = Date.parse(right.updatedAt) || 0;
      return rightTs - leftTs;
    });

    return rows;
  }, [activeSessionId, sessions]);

  const mediaCount = sceneRows.filter((row) => row.outputKind === 'media').length;
  const codeCount = sceneRows.length - mediaCount;

  const handleOpenInStudio = async (sessionId: string) => {
    await selectSession(sessionId);
    await navigate({ to: '/chat' });
  };

  return (
    <div className="h-full w-full overflow-y-auto p-4 xl:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/80">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-white/45">Workspace</p>
              <h1 className="text-lg font-semibold text-white">Scenes</h1>
            </div>
          </div>

          <Link to="/chat" className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Studio
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <article className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Total scenes</p>
            <p className="mt-1 text-2xl font-semibold text-white">{sceneRows.length}</p>
          </article>

          <article className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Code outputs</p>
            <p className="mt-1 text-2xl font-semibold text-white">{codeCount}</p>
          </article>

          <article className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Media outputs</p>
            <p className="mt-1 text-2xl font-semibold text-white">{mediaCount}</p>
          </article>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/30 p-3 xl:p-4">
          {sceneRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm text-white/55">
              Generate your first scene in Studio and it will appear here.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[860px] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead className="bg-white/[0.04]">
                  <tr className="border-b border-white/10 text-left">
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Scene</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Output</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Skill</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Version</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Updated</th>
                    <th scope="col" className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sceneRows.map((row) => (
                    <tr key={row.versionId} className="border-b border-white/10 bg-white/[0.02] transition hover:bg-white/[0.05] last:border-b-0">
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[11px] font-semibold text-white/75">
                            {row.outputKind === 'media' ? 'M' : 'C'}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white" title={row.sceneId}>{compactSceneLabel(row.sceneId)}</p>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/50">
                              <span className="font-mono">Session {row.sessionId.slice(0, 8)}</span>
                              {row.isActive ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  Active
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className="inline-flex rounded-full border border-white/15 bg-white/5 px-2 py-1 text-xs font-medium uppercase tracking-[0.08em] text-white/72">{row.outputKind}</span>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className="inline-flex rounded-full border border-white/15 bg-white/5 px-2 py-1 text-xs uppercase tracking-[0.08em] text-white/70">{row.skill}</span>
                      </td>
                      <td className="px-3 py-2.5 align-middle text-sm text-white/78">v{row.version}</td>
                      <td className="px-3 py-2.5 align-middle text-xs text-white/65">{formatRelativeTime(row.updatedAt)}</td>
                      <td className="px-3 py-2.5 text-right align-middle">
                        <button
                          type="button"
                          className="inline-flex rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-2.5 py-1 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/20"
                          onClick={() => {
                            void handleOpenInStudio(row.sessionId);
                          }}
                        >
                          Open in Studio
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
