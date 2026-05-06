import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Clapperboard } from 'lucide-react';
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

    for (const session of (sessions || [])) {
      if (!session?.sessionId) continue;
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
    selectSession(sessionId);
    await navigate({ to: '/chat' });
  };

  return (
    <div className="h-full w-full overflow-y-auto p-4 xl:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
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

        <section className="rounded-2xl border border-neutral-800 bg-[#1A1A1A] p-1">
          {sceneRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
                <Clapperboard className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-medium text-neutral-200">No scenes yet</h3>
              <p className="mt-1 text-sm text-neutral-500">Generate your first scene in Studio and it will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl">
              <table className="w-full min-w-[860px] table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead className="border-b border-neutral-800 text-xs font-medium text-neutral-500">
                  <tr>
                    <th scope="col" className="px-5 py-3.5 font-medium uppercase tracking-wider">Scene</th>
                    <th scope="col" className="px-5 py-3.5 font-medium uppercase tracking-wider">Output</th>
                    <th scope="col" className="px-5 py-3.5 font-medium uppercase tracking-wider">Skill</th>
                    <th scope="col" className="px-5 py-3.5 font-medium uppercase tracking-wider">Version</th>
                    <th scope="col" className="px-5 py-3.5 font-medium uppercase tracking-wider">Updated</th>
                    <th scope="col" className="px-5 py-3.5 text-right font-medium uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {sceneRows.map((row) => (
                    <tr key={`${row.sessionId}::${row.versionId}`} className="group transition-colors hover:bg-neutral-800/30">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-800/50 text-[11px] font-semibold text-neutral-400">
                            {row.outputKind === 'media' ? 'M' : 'C'}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-neutral-200" title={row.sceneId}>{compactSceneLabel(row.sceneId)}</p>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                              <span className="font-mono">Session {row.sessionId.slice(0, 8)}</span>
                              {row.isActive ? (
                                <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-500">Active</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span className="inline-flex rounded-md border border-neutral-800 bg-neutral-800/50 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-neutral-400">{row.outputKind}</span>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <span className="inline-flex rounded-md border border-neutral-800 bg-neutral-800/50 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-neutral-400">{row.skill}</span>
                      </td>
                      <td className="px-5 py-4 align-middle text-neutral-400">v{row.version}</td>
                      <td className="px-5 py-4 align-middle text-neutral-400">{formatRelativeTime(row.updatedAt)}</td>
                      <td className="px-5 py-4 text-right align-middle">
                        <button
                          type="button"
                          className="inline-flex rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 opacity-0 transition-all hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100 focus:opacity-100"
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
