import { AaronBust3D } from "~/components/AaronBust3D";

// Temporary verification route -- not linked from anywhere, removed once
// the 3D bust is confirmed and wired into Hero.tsx.
export default function ThreePreview() {
  return (
    <div style={{ background: "#100e0c", minHeight: "100vh", padding: "2rem" }}>
      <div style={{ width: "500px", margin: "0 auto" }}>
        <AaronBust3D />
      </div>
    </div>
  );
}
