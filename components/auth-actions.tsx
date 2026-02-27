"use client";

import { motion } from "framer-motion";
import { LogIn, LogOut } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { useState } from "react";

interface AuthActionsProps {
  authenticated: boolean;
}

export function AuthActions({ authenticated }: AuthActionsProps) {
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    if (pending) return;

    setPending(true);
    try {
      await signOut({ redirect: false });
    } finally {
      window.location.href = "/";
    }
  };

  const handleSignIn = () => {
    if (pending) return;
    setPending(true);
    void signIn("google");
  };

  if (authenticated) {
    return (
      <motion.button
        className="icon-button"
        disabled={pending}
        onClick={() => void handleSignOut()}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
        type="button"
        whileHover={{ y: -2, scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <LogOut size={16} />
        {pending ? "Signing out..." : "Sign out"}
      </motion.button>
    );
  }

  return (
    <motion.button
      className="primary-button"
      disabled={pending}
      onClick={handleSignIn}
      transition={{ type: "spring", stiffness: 240, damping: 20 }}
      type="button"
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <LogIn size={16} />
      {pending ? "Redirecting..." : "Continue with Google"}
    </motion.button>
  );
}
