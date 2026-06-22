"use client";

import { useState, useEffect } from "react";
import LandingHeader from "@/components/landing/LandingHeader";
import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import ModelsSection from "@/components/landing/ModelsSection";
import StatsSection from "@/components/landing/StatsSection";
import CTASection from "@/components/landing/CTASection";
import LandingFooter from "@/components/landing/LandingFooter";
import LoginModal from "@/components/auth/LoginModal";

export default function Home() {
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const handler = () => setShowLogin(true);
    window.addEventListener("show-login-modal", handler);
    return () => window.removeEventListener("show-login-modal", handler);
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <LandingHeader />
      <main>
        <HeroSection />
        <FeaturesSection />
        <ModelsSection />
        <StatsSection />
        <CTASection />
      </main>
      <LandingFooter />

      <LoginModal
        isOpen={showLogin}
        onClose={() => setShowLogin(false)}
        onLoginSuccess={(data, mode) => {
          setShowLogin(false);
          const betaPhase = data?.user?.beta_phase;
          if (mode === "register" && (betaPhase === "" || betaPhase === null || betaPhase === undefined)) {
            window.location.href = "/beta/activate";
          } else {
            window.location.href = "/chat";
          }
        }}
      />
    </div>
  );
}
