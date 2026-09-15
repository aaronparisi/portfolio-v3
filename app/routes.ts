import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("three-preview", "routes/three-preview.tsx"),
] satisfies RouteConfig;
