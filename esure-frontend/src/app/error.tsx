"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
  children,
}: {
  error: Error & { digest?: string } | undefined;
  reset: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (error) {
      console.error("Application error boundary caught:", error);
    }
  }, [error]);

  if (error) {
    return (
      <div className="error-boundary">
        <div className="error-boundary__card">
          <p className="eyebrow">Something went wrong</p>
          <h1>We hit an unexpected snag.</h1>
          <p>
            Esure could not complete this request. You can try again or return
            to the home screen.
          </p>
          <div className="error-boundary__actions">
            <button className="run-button" type="button" onClick={reset}>
              Retry
            </button>
            <a className="run-button run-button--secondary" href="/">
              Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
