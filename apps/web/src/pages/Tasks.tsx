import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ListTodo } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useChatStore, type Session, type SessionMessage } from '../stores';

function compactSceneName(sceneId: string): string {
  const normalized = String(sceneId ?? '').trim();
  if (!normalized) {
    return sceneId;
  }

  if (normalized.length <= 16) {
    return normalized;
  }

  if (normalized.startsWith('scene-')) {
    return `scene-${normalized.slice(-6)}`;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function deriveSessionTitle(session: Session, messages: SessionMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim().length > 0);

  if (latestUserMessage) {
    return latestUserMessage.content;
  }

  if (session.currentScene?.sceneId) {
    return compactSceneName(session.currentScene.sceneId);
  }

  return `Session ${session.sessionId.slice(0, 8)}`;
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

function formatStep(step: string | null | undefined): string {
  if (!step) {
    return 'Waiting';
  }

  return step.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(turnStatus: string): string {
  if (turnStatus === 'running') {
    return 'border-amber-400/35 bg-amber-500/15 text-amber-200';
  }

  if (turnStatus === 'completed') {
    return 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200';
  }

  if (turnStatus === 'failed') {
    return 'border-red-400/35 bg-red-500/15 text-red-200';
  }

  return 'border-white/15 bg-white/5 text-white/65';
}

export default function TasksPage() {
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const messagesBySession = useChatStore((state) => state.messages);
  const taskProgressBySession = useChatStore((state) => state.taskProgressBySession);
  const selectSession = useChatStore((state) => state.selectSession);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'GenVis | Tasks';
  }, []);

  const rows = useMemo(() => {
    return sessions
      .map((session) => {
        const progress = taskProgressBySession[session.sessionId];
        const tasks = progress?.tasks ?? [];
        const completedTasks = tasks.filter((task) => task.status === 'completed').length;

        return {
          sessionId: session.sessionId,
          isActive: session.sessionId === activeSessionId,
          title: deriveSessionTitle(session, messagesBySession[session.sessionId] ?? []),
          totalTasks: tasks.length,
          completedTasks,
          turnStatus: progress?.turnStatus ?? 'idle',
          stepLabel: formatStep(progress?.currentStep),
          updatedAt: progress?.lastUpdatedAt ?? session.updatedAt,
        };
      })
      .sort((left, right) => {
        const leftTs = Date.parse(left.updatedAt) || 0;
        const rightTs = Date.parse(right.updatedAt) || 0;
        return rightTs - leftTs;
      });
  }, [activeSessionId, messagesBySession, sessions, taskProgressBySession]);

  const runningCount = rows.filter((row) => row.turnStatus === 'running').length;
  const completedCount = rows.filter((row) => row.turnStatus === 'completed').length;

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
              <ListTodo className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-white/45">Pipeline</p>
              <h1 className="text-lg font-semibold text-white">Tasks</h1>
            </div>
          </div>

          <Link to="/chat" className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Studio
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <article className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Tracked sessions</p>
            <p className="mt-1 text-2xl font-semibold text-white">{rows.length}</p>
          </article>

          <article className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Running</p>
            <p className="mt-1 text-2xl font-semibold text-white">{runningCount}</p>
          </article>

          <article className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45">Completed</p>
            <p className="mt-1 text-2xl font-semibold text-white">{completedCount}</p>
          </article>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/30 p-3 xl:p-4">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center text-sm text-white/55">
              Task progress appears here after you run prompts in Studio.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[860px] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[33%]" />
                  <col className="w-[21%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead className="bg-white/[0.04]">
                  <tr className="border-b border-white/10 text-left">
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Session</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Pipeline Step</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Progress</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Status</th>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Updated</th>
                    <th scope="col" className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const totalTasks = row.totalTasks || 0;
                    const progressPercent = totalTasks > 0 ? Math.round((row.completedTasks / totalTasks) * 100) : 0;

                    return (
                      <tr key={row.sessionId} className="border-b border-white/10 bg-white/[0.02] transition hover:bg-white/[0.05] last:border-b-0">
                        <td className="px-3 py-2.5 align-middle">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white" title={row.title}>{row.title}</p>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/50">
                              <span className="font-mono">Session {row.sessionId.slice(0, 8)}</span>
                              {row.isActive ? (
                                <span className="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">Active</span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <p className="truncate text-sm text-white/78" title={row.stepLabel}>{row.stepLabel}</p>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-white/80">{row.completedTasks}/{totalTasks}</p>
                            <div className="h-1.5 rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-cyan-300/70"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-xs capitalize ${statusClass(row.turnStatus)}`}>{row.turnStatus}</span>
                        </td>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
