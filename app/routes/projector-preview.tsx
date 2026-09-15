import { OverheadProjector3D } from "~/components/OverheadProjector3D";

// Temporary verification route -- not linked from anywhere, removed once the
// projector model is confirmed and placed on the live page.
export default function ProjectorPreview() {
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "2rem", position: "relative" }}>
      <div style={{ width: "600px", margin: "0 auto", position: "relative" }}>
        <OverheadProjector3D />
      </div>
    </div>
  );
}
