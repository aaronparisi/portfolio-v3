import { InfinityTrack3D } from "~/components/InfinityTrack3D";

// Temporary verification route -- not linked from anywhere, for
// iterating on the new hero centerpiece in isolation without waiting
// through the loading screen and the rest of the landing page each
// time. Removed once this is confirmed and wired into Hero.tsx.
export default function InfinityPreview() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", position: "relative" }}>
      <div style={{ width: "100%", height: "100vh", position: "relative" }}>
        <InfinityTrack3D />
      </div>
    </div>
  );
}
