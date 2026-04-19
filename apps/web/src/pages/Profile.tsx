import { useUser } from '@clerk/clerk-react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, User, Key, Database, LogOut, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';

export default function ProfilePage() {
  const { user } = useUser();

  useEffect(() => {
    document.title = 'GenVis | Settings';
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-neutral-900 px-4 py-8 md:py-12">
      <div className="w-full max-w-2xl">
        
        {/* Header */}
        <header className="mb-10 flex items-center gap-4">
          <Link 
            to="/chat" 
            className="flex h-10 w-10 items-center justify-center rounded-xl text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Back to Chat"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-medium tracking-tight text-neutral-100">Settings</h1>
        </header>

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
                  className="whitespace-nowrap rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 focus:ring-offset-neutral-900"
                >
                  Generate New Key
                </button>
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
                  className="whitespace-nowrap rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-700 hover:text-white focus:outline-none"
                >
                  Export Data
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
                  className="whitespace-nowrap rounded-xl border border-red-900/50 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300 focus:outline-none"
                >
                  Delete Account
                </button>
              </div>
            </div>
          </section>

          {/* Footer Links */}
          <div className="mt-8 flex flex-col items-center justify-center gap-4 text-sm text-neutral-500 sm:flex-row sm:gap-8">
            <a href="#" className="flex items-center gap-1.5 transition-colors hover:text-neutral-300">
              Documentation <ExternalLink className="h-3 w-3" />
            </a>
            <a href="#" className="flex items-center gap-1.5 transition-colors hover:text-neutral-300">
              Privacy Policy <ExternalLink className="h-3 w-3" />
            </a>
            <a href="#" className="flex items-center gap-1.5 transition-colors hover:text-neutral-300">
              Terms of Service <ExternalLink className="h-3 w-3" />
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
