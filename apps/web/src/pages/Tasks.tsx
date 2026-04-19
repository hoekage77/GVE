import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ListTodo } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useChatStore, type Session, type SessionMessage } from '../stores';

function compactSceneName(sceneId: string): string {
  const normalized = String(sceneId ?? '').trim();
  if (!normalized) return sceneId;
  if (normalized.length <= 16) return normalized;
  if (normalized.startsWith('scene-')) return `scene-${normalized.slice(-6)}`;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function deriveSessionTitle(session: Session, messages: SessionMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim().length > 0);
  if (latestUserMessage) return latestUserMessage.content;
  if (session.currentScene?.sceneId) return compactSceneName(session.currentScene.sceneId);
  return `Session ${session.sessionId.slice(0, 8)}`;
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const deltaMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (deltaMinutes < 1) return 'Just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  return new Date(value).toLocaleDateString();
}

function formatStep(step: string | null | undefined): string {
  if (!step) return 'Waiting';
  return step.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(turnStatus: string): string {
  if (turnStatus === 'running') return 'border-amber-500/20 bg-amber-500/10 text-amber-500';
  if (turnStatus === 'completed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500';
  if (turnStatus === 'failed') return 'border-red-500/20 bg-red-500/10 text-red-500';
  return 'border-neutral-700/50 bg-neutral-800 text-neutral-400';
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
    <div className="h-full w-full overflow-y-auto bg-neutral-900 p-4 xl:p-8 font-sans text-neutral-200">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-300">
              <ListTodo className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-medium tracking-tight text-neutral-100">Tasks Pipeline</h1>
              <p className="text-sm text-neutral-400">Monitor and manage your background generations</p>
            </div>
          </div>
          <Link to="/chat" className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-neutral-100">
            <ArrowLeft className="h-4 w-4" />
            Back to Studio
          </Link>
        </header>

        {/* Metrics */}
        <section className="grid gap-4 md:grid-cols-3">
          <article className="flex flex-col rounded-2xl border border-neutral-800 bg-[#1A1A1A] p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Tracked Sessions</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-neutral-100">{rows.length}</p>
          </article>
          <article className="flex flex-col rounded-2xl border border-neutral-800 bg-[#1A1A1A] p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Running</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-neutral-100">{runningCount}</p>
          </article>
          <article className="flex flex-col rounded-2xl border border-neutral-800 bg-[#1A1A1A] p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Completed</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-neutral-100">{completedCount}</p>
          </article>
        </section>

        {/* Tasks Table */}
        <section className="rounded-2xl border border-neutral-800 bg-[#1A1A1A] p-1">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
                <ListTodo className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-sm font-medium text-neutral-200">No tasks yet</h3>
              <p className="mt-1 text-sm text-neutral-500">Task progress appears here after you run prompts in the Studio.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl">
              <table className="w-full min-w-[860px] table-fixed border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-[35%]" />
                  <col className="w-[20%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead className="border-b border-neutral-800 text-xs font-medium text-neutral-500">
                  <tr>
                    <th scope="col" className="px-5 py-3.5 font-medium">Session</th>
                    <th scope="col" className="px-5 py-3.5 font-medium">Pipeline Step</th>
                    <th scope="col" className="px-5 py-3.5 font-medium">Progress</th>
                    <th scope="col" className="px-5 py-3.5 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3.5 font-medium">Updated</th>
                    <th scope="col" className="px-5 py-3.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {rows.map((row) => {
                    const totalTasks = row.totalTasks || 0;
                    const progressPercent = totalTasks > 0 ? Math.round((row.completedTasks / totalTasks) * 100) : 0;

                    return (
                      <tr key={row.sessionId} className="group transition-colors hover:bg-neutral-800/30">
                        <td className="px-5 py-4 align-middle">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-neutral-200" title={row.title}>{row.title}</p>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                              <span className="font-mono">ID: {row.sessionId.slice(0, 8)}</span>
                              {row.isActive && (
                                <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-500">Active</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <p className="truncate text-neutral-400" title={row.stepLabel}>{row.stepLabel}</p>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <div className="flex w-full items-center gap-3">
                            <span className="min-w-[28px] text-xs font-medium text-neutral-400">{row.completedTasks}/{totalTasks}</span>
                            <div className="h-1.5 flex-1 rounded-full bg-neutral-800">
                              <div
                                className="h-full rounded-full bg-neutral-300 transition-all duration-500 ease-out"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusClass(row.turnStatus)}`}>
                            {row.turnStatus}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-middle text-neutral-400">
                          {formatRelativeTime(row.updatedAt)}
                        </td>
                        <td className="px-5 py-4 text-right align-middle">
                          <button
                            type="button"
                            className="inline-flex rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-300 opacity-0 transition-all hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100 focus:opacity-100"
                            onClick={() => {
                              void handleOpenInStudio(row.sessionId);
                            }}
                          >
                            Open
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
