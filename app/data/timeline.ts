export type TimelineIcon =
  | "cap"
  | "chalkboard"
  | "briefcase"
  | "headset"
  | "laptop"
  | "chart"
  | "terminal";

export interface TimelineEntry {
  id: string;
  range: string;
  title: string;
  org: string;
  bullets: string[];
  icon: TimelineIcon;
  current?: boolean;
}

export const timeline: TimelineEntry[] = [
  {
    id: "hartwick",
    range: "2010 – 2014",
    title: "BA, Mathematics & Economics",
    org: "Hartwick College",
    bullets: [
      "Linear Algebra, Discrete Mathematics, Differential Equations, Real Analysis",
      "Econometric mathematical modeling using STATA",
      "Overall GPA: 3.9 / 4.0",
    ],
    icon: "cap",
  },
  {
    id: "salisbury",
    range: "2014 – 2015",
    title: "Mathematics Teacher",
    org: "Salisbury School",
    bullets: ["Taught AP Calculus BC, Multivariable Calculus, and Probability & Statistics"],
    icon: "chalkboard",
  },
  {
    id: "1031services",
    range: "2018 – 2020",
    title: "Administrative Assistant",
    org: "1031 Services, Inc.",
    bullets: [
      "Served as primary point of contact for clients",
      "Managed a high-volume caseload and the accurate transfer of real estate proceeds",
    ],
    icon: "briefcase",
  },
  {
    id: "appacademy",
    range: "2020 – 2022",
    title: "Web Development",
    org: "App Academy Open",
    bullets: ["Curriculum: Rails, React, Redux, TypeScript"],
    icon: "terminal",
  },
  {
    id: "plaid",
    range: "2021 – 2022",
    title: "Support Engineer",
    org: "Plaid",
    bullets: [
      "Investigated OAuth, MFA, and data accuracy issues",
      "Communicated extensively with clients and developers outside of Plaid",
    ],
    icon: "headset",
  },
  {
    id: "rxdu",
    range: "2022",
    title: "Freelance Developer",
    org: "rx.du",
    bullets: ["Maintained a Shoptelligence widget built in React"],
    icon: "laptop",
  },
  {
    id: "coinmetrics",
    range: "2022 – 2023",
    title: "Frontend Developer",
    org: "CoinMetrics",
    bullets: [
      "Refactored client-facing apps between React and vanilla JavaScript",
      "Rendered data visualizations using Plotly.js and D3.js",
    ],
    icon: "chart",
  },
  {
    id: "turngate",
    range: "2023 – Present",
    title: "Frontend Developer",
    org: "Turngate",
    bullets: [
      "Created state-of-the-art data visualizations with Recharts",
      "Built a component library using React, TypeScript, Storybook, Material Base UI, Tailwind CSS, and Playwright for testing",
      "Architected data filtering functionality to facilitate custom cybersecurity investigations",
      "Orchestrated OAuth2 authentication flows via our auth provider",
    ],
    icon: "terminal",
    current: true,
  },
];
