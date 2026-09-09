import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

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
const themeInitScript = `
(function () {
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
        <ScrollRestoration />
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
