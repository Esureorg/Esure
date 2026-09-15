import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";

export default function Home() {
  return (
    <Suspense fallback={<div className="shell loading-shell">Loading...</div>}>
      <Dashboard />
    </Suspense>
  );
}

