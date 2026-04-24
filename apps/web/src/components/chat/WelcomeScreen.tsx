import { useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export function WelcomeScreen({
  onCreate,
  error,
  isBootstrapping
}: {
  onCreate: (initialPrompt?: string) => Promise<unknown>;
  error: string | null;
  isBootstrapping: boolean;
}) {
  const { user } = useUser();
  const [isCreating, setIsCreating] = useState(false);

  const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const handleCreate = async (prompt?: string) => {
    if (isCreating || isBootstrapping) return;
    setIsCreating(true);
    try {
      await onCreate(prompt);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="relative flex w-full flex-col items-center justify-center bg-transparent">
      {/* Background Glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-meta-accent/10 blur-[140px]" />
      </div>

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="text-center"
        >
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/5 ring-1 ring-white/10 shadow-2xl">
              <Sparkles className="h-8 w-8 text-meta-accent" />
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-6xl">
            {getTimeGreeting()}, {user?.firstName || "there"}.
          </h1>
          <p className="mt-6 text-xl text-white/30 md:text-2xl">What can we build today?</p>
        </motion.div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 w-full rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300"
          >
            {error}
          </motion.div>
        )}
        
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-16"
        >
          <div className="h-px w-24 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </motion.div>
      </div>
    </div>
  );
}
