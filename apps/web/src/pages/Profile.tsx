import { useUser, useClerk } from "../hooks";
import { User, Key, Database, ExternalLink, Copy, Check, Loader2, AlertTriangle, Trash2, Shield } from "lucide-react";
import { useState } from "react";
import { useChatStore } from "../stores";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "../hooks/queries";

export default function ProfilePage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const sessions = useChatStore(s => s.sessions);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // API key management
  const { data: apiKeys, isLoading: keysLoading } = useApiKeys();
  const createKeyMutation = useCreateApiKey();
  const deleteKeyMutation = useDeleteApiKey();
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealedKeyId, setRevealedKeyId] = useState<string | null>(null);

  const handleGenerateKey = async () => {
    try {
      const data = await createKeyMutation.mutateAsync({
        name: newKeyName.trim() || "Unnamed Key",
        scopes: ["*"],
      });
      if (data?.key) {
        setGeneratedKey(data.key);
      }
      setNewKeyName("");
    } catch {
      // handled by mutation state
    }
  };

  const handleCopyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeleteKey = async (id: string) => {
    await deleteKeyMutation.mutateAsync(id);
    if (revealedKeyId === id) setRevealedKeyId(null);
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const data = {
        exportedAt: new Date().toISOString(),
        user: { email: user?.primaryEmailAddress?.emailAddress, name: user?.fullName },
        sessions: sessions.map(s => ({ id: s.sessionId, createdAt: s.currentScene?.createdAt }))
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "genvis-export-" + new Date().toISOString().split("T")[0] + ".json";
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
                <span className="text-sm font-medium text-neutral-300">{user?.primaryEmailAddress?.emailAddress ?? "Loading..."}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-5">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-200">Full Name</span>
                  <span className="text-sm text-neutral-500">How you appear in the workspace</span>
                </div>
                <span className="text-sm font-medium text-neutral-300">{user?.fullName ?? "Loading..."}</span>
              </div>
            </div>
          </section>

          {/* API Keys Section */}
          <section>
            <div className="mb-4 flex items-center gap-2 px-1 text-sm font-medium uppercase tracking-wider text-neutral-500">
              <Key className="h-4 w-4" />
              <h2>API Keys</h2>
            </div>

            <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-[#1A1A1A]">
              {/* Generate new key */}
              <div className="border-b border-neutral-800/50 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-neutral-400">Key name</label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g., Production Server"
                      className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 outline-none focus:border-neutral-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateKey}
                    disabled={createKeyMutation.isPending}
                    className="shrink-0 whitespace-nowrap rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 focus:ring-offset-neutral-900 disabled:opacity-60"
                  >
                    {createKeyMutation.isPending ? "Generating..." : "Generate New Key"}
                  </button>
                </div>

                {createKeyMutation.isError && (
                  <p className="mt-2 text-xs text-red-400">Failed to generate key. Please try again.</p>
                )}
              </div>

              {/* Generated key banner */}
              {generatedKey && (
                <div className="border-b border-neutral-800/50 p-5">
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Shield className="h-4 w-4" />
                      <span className="text-sm font-medium">Copy this key now</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-neutral-700 bg-neutral-900 p-3">
                      <code className="select-all break-all text-xs text-neutral-300">{generatedKey}</code>
                      <button
                        onClick={() => handleCopyKey(generatedKey)}
                        className="flex shrink-0 items-center gap-1 rounded-md p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-neutral-500">You won&apos;t be able to see this key again after leaving this page.</p>
                    <button
                      onClick={() => setGeneratedKey(null)}
                      className="mt-2 text-xs text-neutral-500 underline hover:text-neutral-300"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Key list */}
              <div className="p-5">
                {keysLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                  </div>
                ) : !apiKeys || apiKeys.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Key className="mb-2 h-5 w-5 text-neutral-600" />
                    <p className="text-sm text-neutral-500">No API keys yet</p>
                    <p className="text-xs text-neutral-600">Generate a key to use GenVis from scripts or automation</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {apiKeys.map((key) => (
                      <div
                        key={key.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-neutral-200">{key.name}</span>
                          <div className="flex items-center gap-2 text-xs text-neutral-500">
                            <span className="rounded bg-neutral-800 px-1.5 py-0.5">
                              {Array.isArray(key.scopes) ? key.scopes.join(", ") : "*"}
                            </span>
                            <span>{new Date(key.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => setRevealedKeyId(revealedKeyId === key.id ? null : key.id)}
                            className="rounded-md p-2 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
                            title="Key ID"
                          >
                            {revealedKeyId === key.id ? (
                              <code className="text-xs">{key.id}</code>
                            ) : (
                              <Shield className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteKey(key.id)}
                            disabled={deleteKeyMutation.isPending && deleteKeyMutation.variables === key.id}
                            className="rounded-md p-2 text-neutral-500 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                            title="Revoke"
                          >
                            {deleteKeyMutation.isPending && deleteKeyMutation.variables === key.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                  {exporting ? "Exporting..." : "Export Data"}
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
                  {deleteConfirm ? "Confirm Delete" : "Delete Account"}
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
