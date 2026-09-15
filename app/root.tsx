import { isRouteErrorResponse, Links, Meta, Outlet, Scripts } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    // Gruvbox-theme experiment (branch: gruvbox-theme): swapped the
    // Space Grotesk/Permanent Marker pairing for two coder-monospace
    // fonts (Space Mono for display, JetBrains Mono for body/UI — already
    // used for dates/code bits) plus Rock Salt for the hand-written accent
    // role instead of the very-online Permanent Marker/Caveat/Kalam
    // family — a rougher, inkier mark, closer to grease pencil on a
    // chalkboard than a felt-tip highlighter.
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=JetBrains+Mono:wght@400..600&family=Rock+Salt&display=swap",
  },
];

// Applied before hydration so the correct motion state is in place for the
// very first paint, and so the browser's own automatic scroll restoration
// is off before it gets a chance to run. This is a single-route,
// all-anchor-links page — a hard reload should always land wherever the
// URL's #hash points (or the top, if there isn't one), never wherever the
// visitor happened to have scrolled to last time.
//
// There's no theme branch here anymore: the site is staged as one dim room
// lit by a single projector, and that scene doesn't have a "light mode" —
// offering one would just mean turning the room lights on and losing the
// premise. See app.css's single :root palette.
const motionInitScript = `
(function () {
  try {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  } catch (e) {}
  var root = document.documentElement;
  try {
    var storedMotion = localStorage.getItem("motion");
    var motion =
      storedMotion === "on" || storedMotion === "off"
        ? storedMotion
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "off"
        : "on";
    root.setAttribute("data-motion", motion);
  } catch (e) {}
})();
`;

// Placed after the SSR'd content below, so by the time it runs every
// section element already exists in the DOM (no need to wait for
// hydration). Explicitly jumps to the URL's #hash on load, rather than
// leaning on the browser's own native jump-to-fragment behavior, which
// (at least in Chromium) doesn't reliably fire on a plain reload the way
// it does on a fresh navigation once scrollRestoration is "manual".
const scrollToHashScript = `
(function () {
  try {
    if (!window.location.hash) return;
    var el = document.getElementById(window.location.hash.slice(1));
    if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
  } catch (e) {}
})();
`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // data-motion is set by the inline script above before hydration;
    // React never renders it itself, so this expected diff needs to be
    // told not to trigger a hydration-mismatch warning.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: motionInitScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: scrollToHashScript }} />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
