import { AaronBust3D } from "~/components/AaronBust3D";

// Temporary verification route -- not linked from anywhere, removed once
// the 3D bust is confirmed and wired into Hero.tsx. The wrapper below
// mimics the hero's own dark ground + light-cone so the bust can be
// judged in its real context, not in isolation on flat black.
export default function ThreePreview() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "2rem", position: "relative" }}>
      <div aria-hidden="true" className="light-cone lamp-flicker" style={{ position: "absolute", inset: "-4rem 0 auto 0", height: "36rem" }} />
      <div style={{ width: "500px", margin: "0 auto", position: "relative" }}>
        <AaronBust3D />
      </div>
    </div>
  );
}
