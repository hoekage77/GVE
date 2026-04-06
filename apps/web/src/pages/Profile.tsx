import { useUser } from '@clerk/clerk-react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, User, Key, Database } from 'lucide-react';

export default function ProfilePage() {
  const { user } = useUser();

  return (
    <div className="profile-page">
      <header className="profile-header">
        <Link to="/chat" className="back-link">
          <ArrowLeft className="h-4 w-4" />
          Back to Chat
        </Link>
        <h1>Profile Settings</h1>
      </header>

      <div className="profile-content">
        <section className="profile-section">
          <div className="profile-section-header">
            <User className="h-5 w-5" />
            <h2>Account</h2>
          </div>
          <div className="profile-field">
            <label>Email</label>
            <span>{user?.primaryEmailAddress?.emailAddress}</span>
          </div>
          <div className="profile-field">
            <label>Name</label>
            <span>{user?.fullName}</span>
          </div>
        </section>

        <section className="profile-section">
          <div className="profile-section-header">
            <Key className="h-5 w-5" />
            <h2>API Keys</h2>
          </div>
          <p className="profile-hint">
            Manage your API keys for programmatic access to Terranet.
          </p>
          <button type="button" className="profile-button">
            Generate New Key
          </button>
        </section>

        <section className="profile-section">
          <div className="profile-section-header">
            <Database className="h-5 w-5" />
            <h2>Data & Privacy</h2>
          </div>
          <p className="profile-hint">
            Your chat history and generated scenes are stored securely.
          </p>
          <button type="button" className="profile-button secondary">
            Export Data
          </button>
        </section>
      </div>
    </div>
  );
}
