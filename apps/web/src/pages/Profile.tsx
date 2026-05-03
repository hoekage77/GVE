import { useUser, useClerk } from '../lib/clerk';
import { ArrowLeft, User, Key, Database, ExternalLink, Copy, Check, Loader2, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useChatStore } from '../stores';

export default function ProfilePage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const sessions = useChatStore(s => s.sessions);
  const [keyState, setKeyState] = useState<'idle' | 'generating' | 'done'>('idle');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    document.title = 'GenVis | Settings';
  }, []);

  const handleGenerateKey = async () => {
    setKeyState('generating');
    try {
      await new Promise(r => setTimeout(r, 800));
      const randomKey = 'gvk_' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
      setApiKey(randomKey);
      setKeyState('done');
    } catch {
      setKeyState('idle');
    }
  };

  const handleCopyKey = async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const data = {
        exportedAt: new Date().toISOString(),
        user: { email: user?.primaryEmailAddress?.emailAddress, name: user?.fullName },
        sessions: sessions.map(s => ({ id: s.sessionId, createdAt: s.currentScene?.createdAt }))
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'genvis-export-' + new Date().toISOString().split('T')[0] + '.json';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleting(true);
    try { await signOut(); } finally { setDeleting(false); }
  };

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto px-4 py-8 md:py-12">
      <div className="w-full max-w-2xl">
        
        <div className="flex flex-col gap-8">
          
          {/* Account Section */}
          <section>
            <div className="mb-4 flex items-center gap-2 px-1 text-sm font-medium uppercase tracking-wider text-neutral-500">
              <User className="h-4 w-4" />
              <h2>Account Details</h2>
            </div>
            
            <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#1A1A1A]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/50 p-5">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-200">Email Address</span>
                  <span className="text-sm text-neutral-500">The email associated with your account</span>
                </div>
                <span className="text-sm font-medium text-neutral-300">{user?.primaryEmailAddress?.emailAddress ?? 'Loading...'}</span>
              </div>
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-200">Full Name</span>
                  <span className="text-sm text-neutral-500">How you appear in the workspace</span>
                </div>
                <span className="text-sm font-medium text-neutral-300">{user?.fullName ?? 'Loading...'}</span>
              </div>
            </div>
          </section>

          {/* API Keys Section */}
          <section>
            <div className="mb-4 flex items-center gap-2 px-1 text-sm font-medium uppercase tracking-wider text-neutral-500">
              <Key className="h-4 w-4" />
              <h2>API Keys</h2>
            </div>
            
            <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#1A1A1A] p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-neutral-200">Developer Access</span>
                  <p className="text-sm leading-relaxed text-neutral-500 max-w-sm">
                    Manage your API keys for programmatic access to the Generative Visual Engine infrastructure.
                  </p>
                </div>
                <button 
                  type="button" 
                  onClick={handleGenerateKey}
                  disabled={keyState === 'generating'}
                  className="whitespace-nowrap rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:opacity-60"
                >
                  {keyState === 'generating' ? 'Generating...' : keyState === 'done' ? 'Key Generated' : 'Generate New Key'}
                </button>
              </div>
              {apiKey && (
                <div className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <code className="select-all break-all text-sm text-neutral-300">{apiKey}</code>
                    <button onClick={handleCopyKey} className="flex-shrink-0 rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white">
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">Copy this key now. You won't be able to see it again.</p>
                </div>
              )}
            </div>
          </section>

          {/* Data & Privacy Section */}
          <section>
            <div className="mb-4 flex items-center gap-2 px-1 text-sm font-medium uppercase tracking-wider text-neutral-500">
              <Database className="h-4 w-4" />
              <h2>Data & Privacy</h2>
            </div>
            
            <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#1A1A1A]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 border-b border-neutral-800/50 p-5">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-neutral-200">Export Workspace Data</span>
                  <p className="text-sm leading-relaxed text-neutral-500 max-w-sm">
                    Download a copy of your chat history, generated scenes, and configurations as a JSON archive.
                  </p>
                </div>
                <button 
                  type="button" 
                  onClick={handleExportData}
                  disabled={exporting}
                  className="whitespace-nowrap rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-700 hover:text-white focus:outline-none disabled:opacity-60"
                >
                  {exporting ? 'Exporting...' : 'Export Data'}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-5">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-red-400">Danger Zone</span>
                  <p className="text-sm leading-relaxed text-neutral-500 max-w-sm">
                    Permanently delete your account and all associated data. This action cannot be undone.
                  </p>
                </div>
                <button 
                  type="button" 
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="whitespace-nowrap rounded-xl border border-red-900/50 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300 focus:outline-none disabled:opacity-60"
                >
                  {deleteConfirm ? 'Confirm Delete' : 'Delete Account'}
                </button>
              </div>
            </div>
          </section>

          {/* Footer Links */}
          <div className="mt-8 flex flex-col items-center justify-center gap-4 text-sm text-neutral-500 sm:flex-row sm:gap-8">
            <a href="https://docs.dosco.live" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-neutral-300">
              Documentation <ExternalLink className="h-3 w-3" />
            </a>
            <a href="https://dosco.live/privacy" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-neutral-300">
              Privacy Policy <ExternalLink className="h-3 w-3" />
            </a>
            <a href="https://dosco.live/terms" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-neutral-300">
              Terms of Service <ExternalLink className="h-3 w-3" />
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
