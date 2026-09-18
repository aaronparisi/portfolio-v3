import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("three-preview", "routes/three-preview.tsx"),
  route("projector-preview", "routes/projector-preview.tsx"),
  route("infinity-preview", "routes/infinity-preview.tsx"),
] satisfies RouteConfig;
