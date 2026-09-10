import { useEffect } from "react";

const SECTION_IDS = ["about", "journey", "skills", "contact"];
// How far down the viewport a section's top has to cross before it's
// considered "current" — a fraction of viewport height, not a fixed
// pixel count, so it holds up across screen sizes.
const ACTIVATION_LINE = 0.2;

/**
 * Keeps the URL's #hash in sync with whichever section is currently in
 * view, using replaceState — never pushState — so it neither adds a
 * history entry per scroll tick nor triggers the browser's jump-to-
 * anchor scroll (this only updates the address bar; it doesn't move the
 * page). Falls back to #top above the first tracked section, matching
 * the id already on the page's root wrapper.
 */
export function useActiveSectionHash() {
  useEffect(() => {
    const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    let current = window.location.hash.slice(1);
    let ticking = false;

    function update() {
      ticking = false;
      const line = window.innerHeight * ACTIVATION_LINE;
      let activeId = "top";
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) {
          activeId = section.id;
        }
      }
      if (activeId === current) return;
      current = activeId;
      const url = `${window.location.pathname}${window.location.search}#${activeId}`;
      window.history.replaceState(window.history.state, "", url);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
}
