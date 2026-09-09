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
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&family=Chakra+Petch:wght@500..700&family=Caveat:wght@500..700&family=JetBrains+Mono:wght@400..600&display=swap",
  },
];

// Applied before hydration so the correct Solarized variant, and the
// correct parallax on/off state, are in place for the very first paint.
//
// Also turns off the browser's own automatic scroll restoration. This is
// a single-route, all-anchor-links page (no <ScrollRestoration> — React
// Router's version is for restoring position across client-side route
// transitions, and its injected pre-hydration script was the actual bug:
// it unconditionally re-scrolls to whatever Y offset was last recorded
// for this history entry, which is exactly "refreshing on #top scrolls
// back down to wherever I was". With the browser's own auto-restore off
// and nothing re-applying an old offset, a reload just falls back to the
// browser's normal load behavior: jump to the URL's #hash, or the top if
// there isn't one.
const themeInitScript = `
(function () {
  try {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  } catch (e) {}
  var root = document.documentElement;
  try {
    var storedTheme = localStorage.getItem("theme");
    var theme =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    root.setAttribute("data-theme", theme);
  } catch (e) {}
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
// hydration). Explicitly jumps to the URL's #hash on load — rather than
// leaning on the browser's own native jump-to-fragment behavior, which
// (at least in Chromium) turned out not to reliably fire on a plain
// reload the way it does on a fresh navigation, once scrollRestoration
// is "manual". Doing it ourselves works the same way every time:
// reload, fresh nav, or otherwise.
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
    // data-theme / data-motion are set by the inline script above before
    // hydration; React never renders them itself, so this expected diff
    // needs to be told not to trigger a hydration-mismatch warning.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
