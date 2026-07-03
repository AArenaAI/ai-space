"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";

interface AuthAwareButtonProps {
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "text";
  icon?: React.ReactNode;
}

export function showLoginModal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("show-login-modal"));
  }
}

export default function AuthAwareButton({
  children,
  className,
  variant = "primary",
  icon,
}: AuthAwareButtonProps) {
  const router = useRouter();
  const auth = useAuth();

  const handleClick = () => {
    if (auth.status === "authenticated") {
      router.push("/chat");
    } else {
      showLoginModal();
    }
  };

  const baseStyles =
    "inline-flex items-center justify-center gap-2 text-sm transition-all duration-200 cursor-pointer";

  const variantStyles = {
    primary:
      "px-6 py-3 rounded-xl bg-brand text-white font-medium hover:bg-brand-hover shadow-lg shadow-brand/25 hover:shadow-brand/40 hover:-translate-y-0.5",
    secondary:
      "px-6 py-3 rounded-xl bg-surface-card border border-surface-border text-text-primary font-medium hover:bg-surface-elevated hover:-translate-y-0.5",
    text: "text-sm text-text-secondary hover:text-text-primary transition-colors px-3 py-2",
  };

  return (
    <button
      onClick={handleClick}
      className={cn(baseStyles, variantStyles[variant], className)}
    >
      {icon}
      {children}
    </button>
  );
}
