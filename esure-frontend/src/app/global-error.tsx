"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="error-boundary-page">
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
      </body>
    </html>
  );
}
